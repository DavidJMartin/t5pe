// Human-readable decoding of MIDI traffic, for the monitor and tool traces.
import { hex, hexByte } from './hex';
import { NrpnDecoder } from './nrpn/decoder';
import { nrpnInfo } from './params/nrpnTable';
import { readName } from './patch/name';
import { parseIdentityReply, parseTake5 } from './sysex/messages';

export interface Described {
  text: string;
  /** False for CCs that only make up an NRPN still in progress; the monitor hides these unless --raw. */
  complete: boolean;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export function nrpnLabel(param: number): string {
  const info = nrpnInfo(param);
  return info ? `#${param} ${info.name}${info.global ? ' (GLOBAL)' : ''}` : `#${param} (undocumented)`;
}

/** Stateful: keeps NRPN state per channel, so use one per direction. */
export class MidiDescriber {
  private nrpn = new NrpnDecoder();

  describe(msg: Uint8Array): Described {
    if (msg.length === 0) return { text: '(empty)', complete: true };
    const status = msg[0];
    if (status === 0xf0) return { text: describeSysex(msg), complete: true };
    if (status >= 0xf8) return { text: realtime(status), complete: true };
    if (status >= 0xf0) return { text: `System ${hex(msg)}`, complete: true };

    const ch = `ch${(status & 0x0f) + 1}`;
    const d1 = msg[1] ?? 0;
    const d2 = msg[2] ?? 0;
    switch (status & 0xf0) {
      case 0x80:
        return { text: `${ch} NoteOff ${noteName(d1)} vel ${d2}`, complete: true };
      case 0x90:
        return { text: `${ch} ${d2 === 0 ? 'NoteOff' : 'NoteOn'} ${noteName(d1)} vel ${d2}`, complete: true };
      case 0xa0:
        return { text: `${ch} PolyAT ${noteName(d1)} ${d2}`, complete: true };
      case 0xb0:
        return this.controlChange(status & 0x0f, ch, d1, d2);
      case 0xc0:
        return { text: `${ch} ProgramChange ${d1}`, complete: true };
      case 0xd0:
        return { text: `${ch} ChannelAT ${d1}`, complete: true };
      case 0xe0:
        return { text: `${ch} PitchBend ${((d2 << 7) | d1) - 8192}`, complete: true };
      default:
        return { text: hex(msg), complete: true };
    }
  }

  private controlChange(channel: number, ch: string, cc: number, value: number): Described {
    const event = this.nrpn.controlChange(channel, cc, value);
    if (event?.kind === 'value') {
      return { text: `${ch} NRPN ${nrpnLabel(event.param)} = ${event.value}`, complete: true };
    }
    if (event) {
      return { text: `${ch} NRPN ${nrpnLabel(event.param)} ${event.kind} ${event.amount}`, complete: true };
    }
    if (NrpnDecoder.isNrpnController(cc)) return { text: `${ch} CC${cc} = ${value}`, complete: false };
    const named = cc === 0 ? ' (BankSelect MSB)' : cc === 32 ? ' (BankSelect LSB)' : '';
    return { text: `${ch} CC${cc}${named} = ${value}`, complete: true };
  }
}

export function describeSysex(msg: Uint8Array): string {
  const identity = parseIdentityReply(msg);
  if (identity) {
    const who = identity.isTake5 ? 'Take 5' : `manufacturer ${hex(identity.manufacturer)}`;
    return `IdentityReply ${who} ch=${hexByte(identity.channel)} [${hex(identity.rest)}]`;
  }
  if (msg.length === 6 && msg[1] === 0x7e && msg[3] === 0x06 && msg[4] === 0x01) {
    return `IdentityRequest ch=${hexByte(msg[2])}`;
  }
  const m = parseTake5(msg);
  if (!m) return `SysEx ${hex(msg, 16)}`;
  const warn = m.warnings.length ? `  ⚠ ${m.warnings.join('; ')}` : '';
  switch (m.kind) {
    case 'programDump':
      return `ProgramDump bank ${m.bank} prog ${m.prog} "${readName(m.data)}" (${msg.length} bytes)${warn}`;
    case 'editBufferDump':
      return `EditBufferDump "${readName(m.data)}" (${msg.length} bytes)${warn}`;
    case 'globalDump':
      return `GlobalDump id=${hexByte(m.deviceId)} [${hex(m.data)}]${warn}`;
    case 'requestProgram':
      return `RequestProgram bank ${m.bank} prog ${m.prog}`;
    case 'requestEditBuffer':
      return 'RequestEditBuffer';
    case 'requestGlobals':
      return 'RequestGlobals';
    case 'unknown':
      return `Take5 unknown command ${hexByte(m.command)} ${hex(msg, 16)}`;
  }
}

function realtime(status: number): string {
  const names: Record<number, string> = { 0xf8: 'Clock', 0xfa: 'Start', 0xfb: 'Continue', 0xfc: 'Stop', 0xfe: 'ActiveSensing', 0xff: 'Reset' };
  return names[status] ?? `Realtime ${hexByte(status)}`;
}
