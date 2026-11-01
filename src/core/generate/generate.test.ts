import { describe, expect, it } from 'vitest';
import { decode, encode, MAPPED } from '../params/codec';
import { rng } from '../random';
import { PROGRAM_BYTES } from '../sysex/constants';
import { breed, fromLibrary, guard, mutate } from './generate';

// A sane starting patch and a small "library" of varied sounds.
const base = encode(new Uint8Array(PROGRAM_BYTES), {
  'program.volume': 110, 'program.bpm': 120, 'mixer.osc1': 120, 'filter.cutoff': 500, 'env2.amount': 120,
  'env2.sustain': 127, 'env2.decay': 60, 'env1.amount': 160, 'osc1.octave': 2, 'osc2.octave': 2,
});
base[3000] = 77; // stands in for unmapped data (e.g. sequencer steps) that must be kept
// Random values everywhere, except tuning, which real patches (the donors) have chosen musically.
const library = Array.from({ length: 30 }, (_, i) => {
  const r = rng(i + 1);
  const values = Object.fromEntries(MAPPED.map((p) => [p.id, p.min + Math.floor(r() * (p.max - p.min + 1))]));
  const octave = 1 + (i % 3);
  Object.assign(values, { 'osc1.fine': 700, 'osc2.fine': 700 + [0, 700, 500, -8][i % 4], 'osc1.octave': octave, 'osc2.octave': octave + (i % 2) });
  return decode(encode(base, values));
});
const ctx = { library };
const immutable = MAPPED.filter((p) => !p.mutable);

const inRange = (data: Uint8Array) => {
  const v = decode(data);
  return MAPPED.every((p) => v[p.id] >= p.min && v[p.id] <= p.max);
};

describe('generation', () => {
  it('is repeatable from the same seed and different with another', () => {
    expect(fromLibrary(base, ctx, rng(5), 0.6)).toEqual(fromLibrary(base, ctx, rng(5), 0.6));
    expect(fromLibrary(base, ctx, rng(5), 0.6)).not.toEqual(fromLibrary(base, ctx, rng(6), 0.6));
  });

  it('keeps every value in range, never touches volume/tempo/arp, and keeps unmapped bytes', () => {
    for (let s = 1; s <= 40; s++) {
      for (const out of [fromLibrary(base, ctx, rng(s), 1), mutate(base, ctx, rng(s), 1), breed([base, encode(base, library[s % 30])], ctx, rng(s), 1)]) {
        expect(inRange(out)).toBe(true);
        const v = decode(out);
        const b = decode(base);
        for (const p of immutable) expect([p.id, v[p.id]]).toEqual([p.id, b[p.id]]);
        expect(out[3000]).toBe(77);
      }
    }
  });

  it('mutation amount scales how much changes', () => {
    const changed = (amount: number) => {
      let total = 0;
      for (let s = 1; s <= 20; s++) {
        const a = decode(base);
        const b = decode(mutate(base, ctx, rng(s), amount));
        total += MAPPED.filter((p) => a[p.id] !== b[p.id]).length;
      }
      return total;
    };
    expect(changed(0.1)).toBeLessThan(changed(0.9));
  });

  it('breeding with no wildness takes every value from one of the parents', () => {
    const p2 = encode(base, library[3]);
    const child = decode(breed([base, p2], ctx, rng(9), 0));
    const [a, b] = [decode(base), decode(p2)];
    const guarded = new Set(['mixer.osc1', 'env2.decay', 'env2.amount', 'filter.cutoff']);
    for (const p of MAPPED) if (!guarded.has(p.id)) expect([p.id, [a[p.id], b[p.id]].includes(child[p.id])]).toEqual([p.id, true]);
  });

  it('keeps tuning musical: osc 1 near pitch, osc 2 at an interval of it, give or take a few cents', () => {
    const intervals = [0, 3, 4, 5, 7, -5, -7].map((st) => st * 100);
    for (let s = 1; s <= 60; s++) {
      for (const out of [fromLibrary(base, ctx, rng(s), 1), mutate(base, ctx, rng(s), 1)]) {
        const v = decode(out);
        const off = v['osc2.fine'] - v['osc1.fine'];
        expect([off, intervals.some((i) => Math.abs(off - i) <= 30)]).toEqual([off, true]);
        expect(Math.abs(v['osc2.octave'] - v['osc1.octave'])).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps added modulation into pitch at vibrato or blip depth', () => {
    for (let s = 1; s <= 60; s++) {
      const v = decode(mutate(base, ctx, rng(s), 1));
      for (let n = 1; n <= 16; n++) {
        if (!v[`mod${n}.source`] || ![1, 2, 3, 4, 5].includes(v[`mod${n}.dest`])) continue;
        expect(Math.abs(v[`mod${n}.amount`] - 127)).toBeLessThanOrEqual([5, 6].includes(v[`mod${n}.source`]) ? 50 : 12);
      }
    }
  });

  it('guard makes a silent patch audible', () => {
    const v = guard({ 'mixer.osc1': 0, 'mixer.osc2': 0, 'mixer.sub': 0, 'env2.sustain': 0, 'env2.decay': 0, 'env2.amount': 5, 'filter.cutoff': 0, 'env1.amount': 127 });
    expect(v).toMatchObject({ 'mixer.osc1': 100, 'env2.decay': 50, 'env2.amount': 100, 'filter.cutoff': 300 });
  });
});
