import { describe, expect, it } from 'vitest';
import { NrpnDecoder, encodeNrpn } from './decoder';

function feed(d: NrpnDecoder, msgs: Uint8Array[]) {
  return msgs.map((m) => d.controlChange(m[0] & 0x0f, m[1], m[2])).filter((e) => e !== null);
}

describe('NrpnDecoder', () => {
  it('decodes an encoded NRPN, committing on the LSB', () => {
    const d = new NrpnDecoder();
    expect(feed(d, encodeNrpn(0, 29, 512))).toEqual([{ kind: 'value', channel: 0, param: 29, value: 512 }]);
    expect(feed(d, encodeNrpn(3, 4113, 1))).toEqual([{ kind: 'value', channel: 3, param: 4113, value: 1 }]);
  });

  it('remembers the selected parameter across repeated values', () => {
    const d = new NrpnDecoder();
    feed(d, encodeNrpn(0, 31, 10));
    const events = feed(d, [Uint8Array.of(0xb0, 6, 0), Uint8Array.of(0xb0, 38, 11)]);
    expect(events).toEqual([{ kind: 'value', channel: 0, param: 31, value: 11 }]);
  });

  it('does not commit on the MSB alone, and RPN selection deselects', () => {
    const d = new NrpnDecoder();
    const [a, b, c] = encodeNrpn(0, 1, 100);
    expect(feed(d, [a, b, c])).toEqual([]);
    feed(d, [Uint8Array.of(0xb0, 101, 0)]);
    expect(feed(d, [Uint8Array.of(0xb0, 38, 1)])).toEqual([]);
  });

  it('reports increment and decrement', () => {
    const d = new NrpnDecoder();
    const [a, b] = encodeNrpn(0, 10, 0);
    expect(feed(d, [a, b, Uint8Array.of(0xb0, 96, 1)])).toEqual([{ kind: 'increment', channel: 0, param: 10, amount: 1 }]);
  });
});
