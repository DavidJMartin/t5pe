import { describe, expect, it } from 'vitest';
import { PROGRAM_BYTES, PROGRAM_DUMP_LENGTH } from './constants';
import { deviceInquiry, parseIdentityReply, parseTake5, requestEditBuffer, requestGlobals, requestProgram } from './messages';
import { fakeProgramDump } from './testdata';
import { readName } from '../patch/name';

describe('builders', () => {
  it('build the documented requests', () => {
    expect([...deviceInquiry()]).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
    expect([...requestProgram(3, 15)]).toEqual([0xf0, 0x01, 0x35, 0x05, 3, 15, 0xf7]);
    expect([...requestEditBuffer()]).toEqual([0xf0, 0x01, 0x35, 0x06, 0xf7]);
    expect([...requestGlobals()]).toEqual([0xf0, 0x01, 0x35, 0x0e, 0xf7]);
  });
});

describe('parseIdentityReply', () => {
  it('parses the documented Take 5 reply', () => {
    const r = parseIdentityReply(Uint8Array.of(0xf0, 0x7e, 0x00, 0x06, 0x02, 0x01, 0x35, 0x01, 0x00, 0x00, 2, 0, 1, 0xf7));
    expect(r?.isTake5).toBe(true);
    expect(r?.channel).toBe(0);
    expect([...r!.versionBytes]).toEqual([2, 0, 1]);
  });

  it('handles 3-byte manufacturer IDs and rejects non-replies', () => {
    const r = parseIdentityReply(Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x02, 0x00, 0x20, 0x29, 1, 2, 3, 4, 0xf7));
    expect(r?.manufacturer).toEqual([0x00, 0x20, 0x29]);
    expect(r?.isTake5).toBe(false);
    expect(parseIdentityReply(deviceInquiry())).toBeNull();
  });
});

describe('parseTake5', () => {
  it('parses a program dump to canonical data with its name', () => {
    const msg = fakeProgramDump(2, 9, 'Fat EP');
    expect(msg.length).toBe(PROGRAM_DUMP_LENGTH);
    const m = parseTake5(msg);
    expect(m?.kind).toBe('programDump');
    if (m?.kind !== 'programDump') return;
    expect([m.bank, m.prog]).toEqual([2, 9]);
    expect(m.data.length).toBe(PROGRAM_BYTES);
    expect(readName(m.data)).toBe('Fat EP');
    expect(m.warnings).toEqual([]);
  });

  it('warns about a short dump instead of throwing', () => {
    const m = parseTake5(Uint8Array.of(0xf0, 0x01, 0x35, 0x02, 0, 0, 1, 2, 3, 0xf7));
    expect(m?.kind).toBe('programDump');
    expect(m?.warnings.length).toBeGreaterThan(0);
  });

  it('accepts the global dump with either device ID', () => {
    for (const id of [0x35, 0x31]) {
      const m = parseTake5(Uint8Array.of(0xf0, 0x01, id, 0x0f, 0, 1, 2, 0xf7));
      expect(m?.kind).toBe('globalDump');
    }
    expect(parseTake5(Uint8Array.of(0xf0, 0x01, 0x31, 0x02, 0xf7))).toBeNull();
  });

  it('ignores other manufacturers', () => {
    expect(parseTake5(Uint8Array.of(0xf0, 0x02, 0x35, 0x02, 0xf7))).toBeNull();
  });
});
