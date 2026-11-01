// Every Take 5 protocol constant lives here. Section references are to docs/protocol.md.

export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;

// §2: universal non-realtime SysEx, used for device inquiry.
export const UNIVERSAL_NON_REALTIME = 0x7e;
export const ALL_CHANNELS = 0x7f;
export const GENERAL_INFO = 0x06;
export const IDENTITY_REQUEST = 0x01;
export const IDENTITY_REPLY = 0x02;

// §4: all Take 5 messages start F0 01 35.
export const MANUFACTURER_SEQUENTIAL = 0x01;
export const DEVICE_TAKE5 = 0x35;
// UNVERIFIED: see protocol.md §4.4. The doc prints the global dump ID as 0x31 (Pro 3); accept both.
export const DEVICE_GLOBAL_DUMP_DOC = 0x31;

export const Command = {
  ProgramDump: 0x02, // §4.2, both directions. Sending one to the synth WRITES FLASH.
  EditBufferDump: 0x03, // §4.3, both directions.
  RequestProgram: 0x05, // §4.1
  RequestEditBuffer: 0x06, // §4.1
  RequestGlobals: 0x0e, // §4.1
  GlobalDump: 0x0f, // §4.4, synth → computer only.
} as const;

// §3.1: 4096 data bytes, padded with 6 zeros to 4102, packed 7→8 into 4688.
export const PROGRAM_BYTES = 4096;
export const PACKED_PROGRAM_BYTES = 4688;
export const PROGRAM_DUMP_LENGTH = 4695; // F0 01 35 02 bank prog <4688> F7
export const EDIT_BUFFER_DUMP_LENGTH = 4693; // F0 01 35 03 <4688> F7

// §4.4: 27 data bytes packed into 32. UNVERIFIED.
export const GLOBAL_DATA_BYTES = 27;

// §3.2
export const NAME_OFFSET = 195;
export const NAME_LENGTH = 20;

// §4.1 and §7
export const PROGRAMS_PER_BANK = 16;
// VERIFIED 2026-10-24 (probe-banks, protocol.md §7): banks 0–31 answer dump requests; 32–127 don't.
export const BANK_COUNT = 32;
// UNVERIFIED: see protocol.md §7. 0–15 look like the 16 user banks (panel 1–9, A–G); 16–31 hold factory content.
export const USER_BANK_COUNT = 16;
