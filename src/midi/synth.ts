// The browser app's connection to the Take 5. Its transport allows only 'read' and 'volatile'
// messages, so nothing the app does can write the synth's memory (CLAUDE.md rule 3).
import { encodeNrpn, NrpnDecoder } from '../core/nrpn/decoder';
import { readName } from '../core/patch/name';
import { BANK_COUNT, PROGRAMS_PER_BANK, USER_BANK_COUNT } from '../core/sysex/constants';
import { deviceInquiry, editBufferDump, parseIdentityReply, parseTake5, programDump } from '../core/sysex/messages';
import { collect, RequestTimeout } from './request';
import { fetchEditBuffer, fetchProgram, type ProgramDump } from './take5';
import { sleep, WebMidiTransport } from './transport';

const PORT_NAME = /take ?5/i;
/** Replies can take ~1.5 s (one dump per ~1.53 s, protocol.md §4.1). */
const REQUEST_TIMEOUT_MS = 4000;
/**
 * A dump requested within ~1.53 s of the previous one is answered late and STALE: it doesn't include
 * changes made in the meantime (protocol.md §4.1). Fresh reads wait this long after the last dump.
 */
const DUMP_COOLDOWN_MS = 1650;

export class SynthNotFound extends Error {}

export interface ReadProgress {
  done: number;
  total: number;
  bank: number;
  prog: number;
  name?: string;
}

export class Synth {
  readonly transport: WebMidiTransport;
  readonly identity: Uint8Array;
  /** A panel parameter change arrived as NRPN. */
  onNrpn?: (nrpn: number, value: number) => void;
  /** The synth changed program (panel or footswitch). */
  onProgramChange?: (program: number) => void;
  /** Sending failed (e.g. the synth was unplugged). */
  onSendError?: (err: unknown) => void;

  private lastDumpAt = 0;
  private auditionBusy = false;
  private auditionNext: Uint8Array | null = null;
  private nrpnPending = new Map<number, number>();
  private nrpnBusy = false;
  private readonly decoder = new NrpnDecoder();

  private constructor(transport: WebMidiTransport, identity: Uint8Array) {
    this.transport = transport;
    this.identity = identity;
    transport.onMessage((m) => this.onMessage(m));
  }

  /** Asks for MIDI + SysEx permission, finds the Take 5 by port name and confirms it with a device inquiry. */
  static async connect(): Promise<Synth> {
    if (!navigator.requestMIDIAccess) throw new SynthNotFound('This browser has no Web MIDI. Use Chrome or Edge.');
    const access = await navigator.requestMIDIAccess({ sysex: true });
    const input = [...access.inputs.values()].find((p) => PORT_NAME.test(p.name ?? ''));
    const output = [...access.outputs.values()].find((p) => PORT_NAME.test(p.name ?? ''));
    if (!input || !output) {
      const names = [...access.outputs.values()].map((p) => p.name).join(', ') || 'none';
      throw new SynthNotFound(`No Take 5 MIDI port found (ports: ${names}). Is it plugged in over USB?`);
    }
    // A small gap keeps NRPN drags smooth while still rate-limiting output (CLAUDE.md rule 5).
    const transport = new WebMidiTransport(input, output, { allow: ['read', 'volatile'], minGapMs: 2 });
    const replies = await collect(transport, deviceInquiry(), (m) => (parseIdentityReply(m)?.isTake5 ? m : null), 1000);
    if (!replies[0]) {
      await transport.close();
      throw new SynthNotFound(
        'The Take 5 port is there but the synth did not answer. If this worked before, switch the Take 5 off and on again ' +
          '(it occasionally stops answering until restarted). Otherwise check Global → MIDI Sysex is On and Sysex Cable is USB.',
      );
    }
    return new Synth(transport, replies[0]);
  }

  private onMessage(m: Uint8Array): void {
    const status = m[0] & 0xf0;
    if (status === 0xb0) {
      const e = this.decoder.controlChange(m[0] & 0x0f, m[1], m[2]);
      if (e?.kind === 'value') this.onNrpn?.(e.param, e.value);
    } else if (status === 0xc0) {
      this.onProgramChange?.(m[1]);
    } else if (m[0] === 0xf0) {
      const kind = parseTake5(m)?.kind;
      if (kind === 'programDump' || kind === 'editBufferDump') this.lastDumpAt = Date.now();
    }
  }

  /**
   * Sends a patch to the edit buffer. Replaces the current sound (unsaved panel edits are lost);
   * writes nothing to memory. While a send is in flight only the latest request is kept.
   */
  audition(data: Uint8Array): void {
    this.auditionNext = editBufferDump(data);
    if (!this.auditionBusy) void this.pumpAudition();
  }

  private async pumpAudition(): Promise<void> {
    this.auditionBusy = true;
    try {
      while (this.auditionNext) {
        const msg = this.auditionNext;
        this.auditionNext = null;
        await this.transport.send(msg);
        this.lastDumpAt = Date.now();
      }
    } catch (err) {
      this.auditionNext = null;
      this.onSendError?.(err);
    } finally {
      this.auditionBusy = false;
    }
  }

  /** Sets one parameter on the edit buffer. While dragging, only the latest value per parameter is sent. */
  sendNrpn(nrpn: number, value: number): void {
    this.nrpnPending.set(nrpn, value);
    if (!this.nrpnBusy) void this.pumpNrpn();
  }

  private async pumpNrpn(): Promise<void> {
    this.nrpnBusy = true;
    try {
      while (this.nrpnPending.size) {
        const [nrpn, value] = this.nrpnPending.entries().next().value!;
        this.nrpnPending.delete(nrpn);
        for (const m of encodeNrpn(0, nrpn, value)) await this.transport.send(m);
      }
    } catch (err) {
      this.nrpnPending.clear();
      this.onSendError?.(err);
    } finally {
      this.nrpnBusy = false;
    }
  }

  /** True while screen edits are still being sent. */
  get sending(): boolean {
    return this.nrpnBusy || this.auditionBusy;
  }

  /** Reads the edit buffer, waiting out the dump cooldown first so the result is fresh. */
  async readEditBuffer(): Promise<Uint8Array> {
    const wait = this.lastDumpAt + DUMP_COOLDOWN_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const { value } = await fetchEditBuffer(this.transport, REQUEST_TIMEOUT_MS);
    return value.data;
  }

  /** Reads one program slot, waiting out the dump cooldown first so the result is fresh. */
  async readProgram(bank: number, prog: number): Promise<Uint8Array> {
    const wait = this.lastDumpAt + DUMP_COOLDOWN_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const { value } = await fetchProgram(this.transport, bank, prog, REQUEST_TIMEOUT_MS);
    return value.data;
  }

  /**
   * WRITES FLASH (CLAUDE.md rule 3): only the push flow calls this, after the user confirms the exact changes.
   * Writes one user-bank slot, then reads it back until it matches (protocol.md §4.2: no ack; a read one
   * cooldown later returns the new data). Rewrites once if the read-back doesn't match. Returns whether verified.
   */
  async writeProgram(bank: number, prog: number, data: Uint8Array): Promise<boolean> {
    if (bank < 0 || bank >= USER_BANK_COUNT || prog < 0 || prog >= PROGRAMS_PER_BANK) {
      throw new Error(`refusing to write ${bank}/${prog}: only user banks 0–${USER_BANK_COUNT - 1} are ever written`);
    }
    for (let write = 1; write <= 2; write++) {
      const wait = this.lastDumpAt + DUMP_COOLDOWN_MS - Date.now();
      if (wait > 0) await sleep(wait);
      await this.transport.allowDuring(['persistent'], () => this.transport.send(programDump(bank, prog, data)));
      this.lastDumpAt = Date.now();
      for (let read = 1; read <= 3; read++) {
        try {
          const back = await this.readProgram(bank, prog);
          if (back.every((b, i) => b === data[i])) return true;
        } catch (err) {
          if (!(err instanceof RequestTimeout)) throw err;
        }
      }
    }
    return false;
  }

  /** Reads every program (banks 0–31, ~13 min). Retries timeouts; reports slots it couldn't read. */
  async readAll(onProgress: (p: ReadProgress) => void, signal: AbortSignal): Promise<{ dumps: ProgramDump[]; missing: string[] }> {
    const total = BANK_COUNT * PROGRAMS_PER_BANK;
    const dumps: ProgramDump[] = [];
    const missing: string[] = [];
    for (let bank = 0; bank < BANK_COUNT; bank++) {
      for (let prog = 0; prog < PROGRAMS_PER_BANK; prog++) {
        if (signal.aborted) return { dumps, missing };
        let dump: ProgramDump | undefined;
        for (let attempt = 0; attempt < 3 && !dump; attempt++) {
          try {
            dump = (await fetchProgram(this.transport, bank, prog, REQUEST_TIMEOUT_MS)).value;
          } catch (err) {
            if (!(err instanceof RequestTimeout)) throw err;
          }
        }
        if (dump) dumps.push(dump);
        else missing.push(`${bank}:${prog}`);
        onProgress({ done: dumps.length + missing.length, total, bank, prog, name: dump ? readName(dump.data) : '(no reply)' });
      }
    }
    return { dumps, missing };
  }

  close(): Promise<void> {
    return this.transport.close();
  }
}
