import { OutboundClassifier, UnsafeSendError, type SafetyLevel } from '../core/safety';
import { SysexAssembler } from '../core/sysex/split';

export type MidiListener = (msg: Uint8Array, timestamp: number) => void;
export type TraceListener = (direction: 'in' | 'out', msg: Uint8Array, timestamp: number) => void;

export interface MidiTransport {
  readonly inputName: string;
  readonly outputName: string;
  /** Queues a message. Rejects with UnsafeSendError if its safety level isn't allowed. */
  send(msg: Uint8Array): Promise<void>;
  /** Subscribes to complete incoming messages. Returns an unsubscribe function. */
  onMessage(listener: MidiListener): () => void;
  close(): Promise<void>;
}

// Minimal structural shapes of Web MIDI ports, satisfied by the browser's MIDIInput/MIDIOutput
// and by the Node adapter in tools/lib/midi.ts.
interface MidiMessageEventLike {
  readonly data: Uint8Array | null;
  readonly timeStamp?: number;
}
type Handler<E> = { bivarianceHack(event: E): void }['bivarianceHack'];

export interface MidiInputPort {
  readonly name?: string | null;
  onmidimessage: Handler<MidiMessageEventLike> | null;
  open?(): Promise<unknown>;
  close?(): Promise<unknown>;
}

export interface MidiOutputPort {
  readonly name?: string | null;
  send(data: Uint8Array | number[], timestamp?: number): void;
  open?(): Promise<unknown>;
  close?(): Promise<unknown>;
}

export interface TransportOptions {
  /** Safety levels this transport may send. Default: read only. */
  allow?: readonly SafetyLevel[];
  /** Minimum gap between outgoing messages (rule 5: rate-limit all output). Default 20 ms. */
  minGapMs?: number;
  trace?: TraceListener;
}

/** Web MIDI implementation of MidiTransport. Used by the browser and, through an adapter, the Node tools. */
export class WebMidiTransport implements MidiTransport {
  readonly inputName: string;
  readonly outputName: string;
  private allow: readonly SafetyLevel[];
  private readonly minGapMs: number;
  private readonly trace?: TraceListener;
  private readonly classifier = new OutboundClassifier();
  private readonly assembler = new SysexAssembler();
  private readonly listeners = new Set<MidiListener>();
  private queue: Promise<void>;
  private lastSend = 0;
  private readonly input: MidiInputPort;
  private readonly output: MidiOutputPort;

  constructor(input: MidiInputPort, output: MidiOutputPort, options: TransportOptions = {}) {
    this.input = input;
    this.output = output;
    this.inputName = input.name ?? '?';
    this.outputName = output.name ?? '?';
    this.allow = options.allow ?? ['read'];
    this.minGapMs = options.minGapMs ?? 20;
    this.trace = options.trace;
    input.onmidimessage = (event) => {
      if (!event.data) return;
      const t = event.timeStamp ?? now();
      for (const msg of this.assembler.feed(new Uint8Array(event.data))) {
        this.trace?.('in', msg, t);
        for (const l of this.listeners) l(msg, t);
      }
    };
    // Setting onmidimessage opens the input lazily (in some implementations asynchronously). Open both ports
    // explicitly and hold every send until they are, or a fast reply can arrive before we listen.
    this.queue = Promise.all([input.open?.(), output.open?.()]).then(() => {});
  }

  /** Resolves once both ports are open. */
  ready(): Promise<void> {
    return this.queue;
  }

  send(msg: Uint8Array): Promise<void> {
    const c = this.classifier.classify(msg);
    if (!this.allow.includes(c.level)) return Promise.reject(new UnsafeSendError(c, this.allow));
    const copy = Uint8Array.from(msg);
    const next = this.queue.then(async () => {
      const wait = this.lastSend + this.minGapMs - now();
      if (wait > 0) await sleep(wait);
      // A plain array: some Node MIDI libraries reject typed arrays; browsers accept either.
      this.output.send(Array.from(copy));
      this.lastSend = now();
      this.trace?.('out', copy, this.lastSend);
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * Allows extra safety levels only while `fn` runs (e.g. 'persistent' for one program write in the push
   * flow). Sends are classified when called, so nothing sent after `fn` settles gets the extra permission.
   */
  async allowDuring<T>(levels: readonly SafetyLevel[], fn: () => Promise<T>): Promise<T> {
    const previous = this.allow;
    this.allow = [...previous, ...levels];
    try {
      return await fn();
    } finally {
      this.allow = previous;
    }
  }

  onMessage(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    await this.queue;
    this.input.onmidimessage = null;
    this.listeners.clear();
    await this.input.close?.();
    await this.output.close?.();
  }
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
