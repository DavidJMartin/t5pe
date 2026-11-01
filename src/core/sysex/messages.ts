import {
  ALL_CHANNELS,
  Command,
  DEVICE_GLOBAL_DUMP_DOC,
  DEVICE_TAKE5,
  EDIT_BUFFER_DUMP_LENGTH,
  GENERAL_INFO,
  IDENTITY_REPLY,
  IDENTITY_REQUEST,
  MANUFACTURER_SEQUENTIAL,
  PACKED_PROGRAM_BYTES,
  PROGRAM_BYTES,
  PROGRAM_DUMP_LENGTH,
  SYSEX_END,
  SYSEX_START,
  UNIVERSAL_NON_REALTIME,
} from './constants';
import { packMsb, unpackMsb } from './pack';

// ---- Builders (computer → synth). All of these are read-only requests. ----

/** §2 */
export function deviceInquiry(channel: number = ALL_CHANNELS): Uint8Array {
  return Uint8Array.of(SYSEX_START, UNIVERSAL_NON_REALTIME, channel & 0x7f, GENERAL_INFO, IDENTITY_REQUEST, SYSEX_END);
}

/** §4.1. UNVERIFIED: bank and program are assumed 0-based. */
export function requestProgram(bank: number, prog: number): Uint8Array {
  return take5(Command.RequestProgram, bank & 0x7f, prog & 0x7f);
}

/** §4.1 */
export function requestEditBuffer(): Uint8Array {
  return take5(Command.RequestEditBuffer);
}

/** §4.1 */
export function requestGlobals(): Uint8Array {
  return take5(Command.RequestGlobals);
}

/** §4.3. Sending this replaces the synth's current sound (volatile; CLAUDE.md rule 2). */
export function editBufferDump(data: Uint8Array): Uint8Array {
  return take5Dump(Command.EditBufferDump, [], data);
}

/** §4.2. For writing .syx files. Sending this to the synth WRITES FLASH, so transports refuse it by default. */
export function programDump(bank: number, prog: number, data: Uint8Array): Uint8Array {
  return take5Dump(Command.ProgramDump, [bank & 0x7f, prog & 0x7f], data);
}

function take5Dump(command: number, address: number[], data: Uint8Array): Uint8Array {
  if (data.length !== PROGRAM_BYTES) throw new Error(`program data must be ${PROGRAM_BYTES} bytes, got ${data.length}`);
  const padded = new Uint8Array(PROGRAM_BYTES + 6); // §3.1: 6 zero bytes of padding
  padded.set(data);
  const packed = packMsb(padded);
  const msg = new Uint8Array(4 + address.length + packed.length + 1);
  msg.set([SYSEX_START, MANUFACTURER_SEQUENTIAL, DEVICE_TAKE5, command, ...address]);
  msg.set(packed, 4 + address.length);
  msg[msg.length - 1] = SYSEX_END;
  return msg;
}

function take5(command: number, ...body: number[]): Uint8Array {
  return Uint8Array.of(SYSEX_START, MANUFACTURER_SEQUENTIAL, DEVICE_TAKE5, command, ...body, SYSEX_END);
}

// ---- Parsers ----

export interface IdentityReply {
  /** SysEx channel the synth answered on (0x7F = all). */
  channel: number;
  /** 1 byte, or 3 bytes for extended IDs starting 00. */
  manufacturer: number[];
  /** Everything after the manufacturer ID, before F7. */
  rest: Uint8Array;
  isTake5: boolean;
  /**
   * UNVERIFIED: see protocol.md §2. Standard layout is family(2) member(2) version(4);
   * the Take 5 doc shows something shorter, so this is everything after the first 4 bytes of `rest`.
   */
  versionBytes: Uint8Array;
}

/** Parse a universal identity reply (F0 7E <ch> 06 02 …). Returns null for anything else. */
export function parseIdentityReply(msg: Uint8Array): IdentityReply | null {
  if (msg.length < 7 || msg[0] !== SYSEX_START || msg[msg.length - 1] !== SYSEX_END) return null;
  if (msg[1] !== UNIVERSAL_NON_REALTIME || msg[3] !== GENERAL_INFO || msg[4] !== IDENTITY_REPLY) return null;
  const body = msg.subarray(5, msg.length - 1);
  const mfrLen = body[0] === 0x00 ? 3 : 1;
  const manufacturer = Array.from(body.subarray(0, mfrLen));
  const rest = body.slice(mfrLen);
  return {
    channel: msg[2],
    manufacturer,
    rest,
    isTake5: mfrLen === 1 && manufacturer[0] === MANUFACTURER_SEQUENTIAL && rest[0] === DEVICE_TAKE5,
    versionBytes: rest.slice(4),
  };
}

export type Take5Message =
  | { kind: 'programDump'; bank: number; prog: number; packed: Uint8Array; data: Uint8Array; warnings: string[] }
  | { kind: 'editBufferDump'; packed: Uint8Array; data: Uint8Array; warnings: string[] }
  | { kind: 'globalDump'; deviceId: number; packed: Uint8Array; data: Uint8Array; warnings: string[] }
  | { kind: 'requestProgram'; bank: number; prog: number; warnings: string[] }
  | { kind: 'requestEditBuffer'; warnings: string[] }
  | { kind: 'requestGlobals'; warnings: string[] }
  | { kind: 'unknown'; deviceId: number; command: number; warnings: string[] };

/**
 * Parse a Take 5 SysEx message (F0 01 35 …, or F0 01 31 0F for the global dump).
 * Returns null if it isn't one. Parses defensively: length surprises become warnings, not errors.
 */
export function parseTake5(msg: Uint8Array): Take5Message | null {
  if (msg.length < 5 || msg[0] !== SYSEX_START || msg[msg.length - 1] !== SYSEX_END) return null;
  if (msg[1] !== MANUFACTURER_SEQUENTIAL) return null;
  const deviceId = msg[2];
  const command = msg[3];
  const warnings: string[] = [];

  if (deviceId === DEVICE_GLOBAL_DUMP_DOC || (deviceId === DEVICE_TAKE5 && command === Command.GlobalDump)) {
    if (command !== Command.GlobalDump) return null; // 0x31 with any other command is a Pro 3 message
    const packed = msg.subarray(4, msg.length - 1);
    if (deviceId !== DEVICE_TAKE5) warnings.push(`global dump uses device ID 0x${deviceId.toString(16)}`);
    return { kind: 'globalDump', deviceId, packed, data: unpackMsb(packed), warnings };
  }
  if (deviceId !== DEVICE_TAKE5) return null;

  switch (command) {
    case Command.ProgramDump: {
      const packed = msg.subarray(6, msg.length - 1);
      if (msg.length !== PROGRAM_DUMP_LENGTH) warnings.push(`program dump is ${msg.length} bytes, expected ${PROGRAM_DUMP_LENGTH}`);
      return { kind: 'programDump', bank: msg[4], prog: msg[5], packed, data: canonical(packed, warnings), warnings };
    }
    case Command.EditBufferDump: {
      const packed = msg.subarray(4, msg.length - 1);
      if (msg.length !== EDIT_BUFFER_DUMP_LENGTH) warnings.push(`edit buffer dump is ${msg.length} bytes, expected ${EDIT_BUFFER_DUMP_LENGTH}`);
      return { kind: 'editBufferDump', packed, data: canonical(packed, warnings), warnings };
    }
    case Command.RequestProgram:
      return { kind: 'requestProgram', bank: msg[4], prog: msg[5], warnings };
    case Command.RequestEditBuffer:
      return { kind: 'requestEditBuffer', warnings };
    case Command.RequestGlobals:
      return { kind: 'requestGlobals', warnings };
    default:
      return { kind: 'unknown', deviceId, command, warnings };
  }
}

/** §3.1: canonical program data is the first 4096 unpacked bytes; the 6 padding bytes should be zero. */
function canonical(packed: Uint8Array, warnings: string[]): Uint8Array {
  if (packed.length !== PACKED_PROGRAM_BYTES) warnings.push(`packed data is ${packed.length} bytes, expected ${PACKED_PROGRAM_BYTES}`);
  const unpacked = unpackMsb(packed);
  const padding = unpacked.subarray(PROGRAM_BYTES);
  if (padding.some((b) => b !== 0)) warnings.push('padding bytes after offset 4096 are not zero');
  return unpacked.slice(0, PROGRAM_BYTES);
}
