// Classifies outbound messages by the hardware safety rules in CLAUDE.md, so transports can refuse
// anything a caller hasn't explicitly allowed.
import { Command, DEVICE_TAKE5, MANUFACTURER_SEQUENTIAL, SYSEX_START } from './sysex/constants';
import { CC } from './nrpn/decoder';
import { isProgramNrpn } from './params/nrpnTable';

export type SafetyLevel =
  /** Rule 1: requests and inquiry. Always fine. */
  | 'read'
  /** Rule 2: replaces the current sound (edit buffer dump, program NRPN, program change). */
  | 'volatile'
  /** Rule 3: writes flash or globals, or anything not otherwise listed. Needs explicit approval. */
  | 'persistent'
  /** Rule 4: never sent (unrecognised SysEx could be an OS update). */
  | 'forbidden';

export interface Classification {
  level: SafetyLevel;
  reason: string;
}

/** Stateful because an NRPN's target parameter is selected by earlier CCs. Use one per output. */
export class OutboundClassifier {
  private selected = new Map<number, { msb: number | null; lsb: number | null }>();

  classify(msg: Uint8Array): Classification {
    if (msg.length === 0) return { level: 'forbidden', reason: 'empty message' };
    const status = msg[0];
    if (status === SYSEX_START) return classifySysex(msg);
    switch (status & 0xf0) {
      case 0xb0:
        return this.controlChange(status & 0x0f, msg[1], msg[2]);
      case 0xc0:
        return { level: 'volatile', reason: 'program change' };
      // Notes just play the current sound; nothing is stored (user approval 2026-10-25, CLAUDE.md rule 2).
      case 0x80:
      case 0x90:
        return { level: 'volatile', reason: 'note' };
      default:
        return { level: 'persistent', reason: `message ${status.toString(16)} is not covered by rules 1–2` };
    }
  }

  private controlChange(channel: number, cc: number, value: number): Classification {
    let s = this.selected.get(channel);
    if (!s) this.selected.set(channel, (s = { msb: null, lsb: null }));
    switch (cc) {
      case CC.NrpnMsb:
        s.msb = value;
        return { level: 'volatile', reason: 'NRPN select' };
      case CC.NrpnLsb:
        s.lsb = value;
        return { level: 'volatile', reason: 'NRPN select' };
      case CC.DataEntryMsb:
      case CC.DataEntryLsb:
      case CC.DataIncrement:
      case CC.DataDecrement: {
        if (s.msb === null || s.lsb === null) return { level: 'persistent', reason: 'data entry with no NRPN selected' };
        const param = (s.msb << 7) | s.lsb;
        return isProgramNrpn(param)
          ? { level: 'volatile', reason: `program NRPN ${param}` }
          : { level: 'persistent', reason: `NRPN ${param} is global or unknown` };
      }
      case 0:
      case 32:
        return { level: 'volatile', reason: 'bank select (part of a program change)' };
      case 120:
      case 123:
        return { level: 'volatile', reason: 'all sound / all notes off' };
      default:
        return { level: 'persistent', reason: `CC${cc} is not covered by rules 1–2` };
    }
  }
}

function classifySysex(msg: Uint8Array): Classification {
  if (msg.length === 6 && msg[1] === 0x7e && msg[3] === 0x06 && msg[4] === 0x01) {
    return { level: 'read', reason: 'device inquiry' };
  }
  if (msg[1] === MANUFACTURER_SEQUENTIAL && msg[2] === DEVICE_TAKE5) {
    switch (msg[3]) {
      case Command.RequestProgram:
      case Command.RequestEditBuffer:
      case Command.RequestGlobals:
        return { level: 'read', reason: 'dump request' };
      case Command.EditBufferDump:
        return { level: 'volatile', reason: 'edit buffer dump' };
      case Command.ProgramDump:
        return { level: 'persistent', reason: 'program dump (writes flash)' };
    }
  }
  return { level: 'forbidden', reason: 'unrecognised SysEx' };
}

export class UnsafeSendError extends Error {
  readonly classification: Classification;
  readonly allowed: readonly SafetyLevel[];

  constructor(classification: Classification, allowed: readonly SafetyLevel[]) {
    super(`refused to send ${classification.level} message (${classification.reason}); allowed: ${allowed.join(', ')}`);
    this.classification = classification;
    this.allowed = allowed;
  }
}
