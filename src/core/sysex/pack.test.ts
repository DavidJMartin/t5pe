import { describe, expect, it } from 'vitest';
import { PACKED_PROGRAM_BYTES, PROGRAM_BYTES } from './constants';
import { packMsb, unpackMsb } from './pack';

describe('packed MS bit', () => {
  it('packs one chunk with the high bits in the header', () => {
    const data = Uint8Array.of(0x81, 0x02, 0xff, 0x00, 0x7f, 0x80, 0x01);
    expect([...packMsb(data)]).toEqual([0b0100101, 0x01, 0x02, 0x7f, 0x00, 0x7f, 0x00, 0x01]);
  });

  it('round-trips arbitrary data, including a partial final chunk', () => {
    for (const len of [0, 1, 6, 7, 8, 13, 14, 100]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      const packed = packMsb(data);
      expect(packed.every((b) => b < 0x80)).toBe(true);
      expect([...unpackMsb(packed)]).toEqual([...data]);
    }
  });

  it('a 4096-byte program plus 6 zero bytes packs to 4688 bytes', () => {
    const data = new Uint8Array(PROGRAM_BYTES + 6);
    for (let i = 0; i < PROGRAM_BYTES; i++) data[i] = (i * 131) & 0xff;
    const packed = packMsb(data);
    expect(packed.length).toBe(PACKED_PROGRAM_BYTES);
    expect([...unpackMsb(packed)]).toEqual([...data]);
  });
});
