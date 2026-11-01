import { SYSEX_END, SYSEX_START } from './constants';

export interface SplitResult {
  messages: Uint8Array[];
  /** Bytes outside any F0…F7 frame, plus truncated frames. Non-zero means the input was odd. */
  strayBytes: number;
  truncated: number;
}

/** Split a byte stream (e.g. a .syx file) into complete F0…F7 messages. */
export function splitSysex(bytes: Uint8Array): SplitResult {
  const messages: Uint8Array[] = [];
  let strayBytes = 0;
  let truncated = 0;
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === SYSEX_START) {
      if (start >= 0) {
        truncated++;
        strayBytes += i - start;
      }
      start = i;
    } else if (b === SYSEX_END) {
      if (start >= 0) {
        messages.push(bytes.slice(start, i + 1));
        start = -1;
      } else {
        strayBytes++;
      }
    } else if (start < 0) {
      strayBytes++;
    }
  }
  if (start >= 0) {
    truncated++;
    strayBytes += bytes.length - start;
  }
  return { messages, strayBytes, truncated };
}

/**
 * Reassembles SysEx that a MIDI stack delivers in pieces. Feed it every incoming message;
 * it returns complete messages (SysEx or not) as they become available.
 * Web MIDI promises whole messages, but Node bindings sometimes split large SysEx.
 */
export class SysexAssembler {
  private parts: Uint8Array[] = [];
  private length = 0;

  feed(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 0) return [];
    const inSysex = this.parts.length > 0;
    if (!inSysex && chunk[0] !== SYSEX_START) return [chunk];
    if (inSysex && chunk[0] === SYSEX_START) this.reset(); // previous one was truncated; drop it
    if (inSysex && chunk[0] >= 0x80 && chunk[0] !== SYSEX_START && chunk[0] < 0xf8 && chunk[0] !== SYSEX_END) {
      // A new non-realtime status byte aborts the SysEx.
      this.reset();
      return [chunk];
    }
    this.parts.push(chunk);
    this.length += chunk.length;
    if (chunk[chunk.length - 1] !== SYSEX_END) return [];
    const whole = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      whole.set(p, o);
      o += p.length;
    }
    this.reset();
    return [whole];
  }

  get pending(): boolean {
    return this.parts.length > 0;
  }

  private reset(): void {
    this.parts = [];
    this.length = 0;
  }
}
