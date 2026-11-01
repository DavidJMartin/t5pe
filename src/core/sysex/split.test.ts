import { describe, expect, it } from 'vitest';
import { SysexAssembler, splitSysex } from './split';

describe('splitSysex', () => {
  it('splits concatenated messages and counts stray bytes', () => {
    const r = splitSysex(Uint8Array.of(0x00, 0xf0, 1, 2, 0xf7, 0xf0, 3, 0xf7, 0x55));
    expect(r.messages.map((m) => [...m])).toEqual([[0xf0, 1, 2, 0xf7], [0xf0, 3, 0xf7]]);
    expect(r.strayBytes).toBe(2);
    expect(r.truncated).toBe(0);
  });

  it('drops truncated messages', () => {
    const r = splitSysex(Uint8Array.of(0xf0, 1, 2, 0xf0, 3, 0xf7, 0xf0, 4));
    expect(r.messages.map((m) => [...m])).toEqual([[0xf0, 3, 0xf7]]);
    expect(r.truncated).toBe(2);
  });
});

describe('SysexAssembler', () => {
  it('passes complete messages straight through', () => {
    const a = new SysexAssembler();
    expect(a.feed(Uint8Array.of(0xb0, 99, 0)).map((m) => [...m])).toEqual([[0xb0, 99, 0]]);
    expect(a.feed(Uint8Array.of(0xf0, 1, 0xf7)).map((m) => [...m])).toEqual([[0xf0, 1, 0xf7]]);
  });

  it('joins SysEx delivered in fragments', () => {
    const a = new SysexAssembler();
    expect(a.feed(Uint8Array.of(0xf0, 1, 2))).toEqual([]);
    expect(a.pending).toBe(true);
    expect(a.feed(Uint8Array.of(3, 4))).toEqual([]);
    expect(a.feed(Uint8Array.of(5, 0xf7)).map((m) => [...m])).toEqual([[0xf0, 1, 2, 3, 4, 5, 0xf7]]);
    expect(a.pending).toBe(false);
  });

  it('abandons a fragment when a new status byte arrives', () => {
    const a = new SysexAssembler();
    a.feed(Uint8Array.of(0xf0, 1));
    expect(a.feed(Uint8Array.of(0x90, 60, 100)).map((m) => [...m])).toEqual([[0x90, 60, 100]]);
    expect(a.pending).toBe(false);
  });
});
