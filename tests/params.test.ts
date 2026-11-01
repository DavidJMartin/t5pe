// Checks the parameter map against real patches: the synth backup (gitignored; skipped if absent).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, diff, encode, MAPPED } from '../src/core/params/codec';
import { parseTake5 } from '../src/core/sysex/messages';
import { splitSysex } from '../src/core/sysex/split';

const backups = existsSync('backups') ? readdirSync('backups').filter((f) => /^take5-.*\.syx$/.test(f)) : [];
const patches = backups.flatMap((f) =>
  splitSysex(new Uint8Array(readFileSync(`backups/${f}`)))
    .messages.map(parseTake5)
    .flatMap((m) => (m?.kind === 'programDump' ? [{ data: m.data, slot: `${m.bank}:${m.prog}` }] : [])),
  )
  // Bank 17 prog 0 holds noise, not a program (protocol.md §7), so it can't be inside any range.
  .filter((p) => p.slot !== '17:0');

describe('parameter map', () => {
  it('no two parameters share a byte', () => {
    const owner = new Map<number, string>();
    for (const p of MAPPED) {
      for (const o of p.offsets) {
        expect(owner.get(o), `byte ${o} claimed by ${owner.get(o)} and ${p.id}`).toBeUndefined();
        owner.set(o, p.id);
      }
    }
  });

  it('every mapped parameter has a range and, for choices, enough names', () => {
    for (const p of MAPPED) {
      expect(p.max, p.id).toBeGreaterThan(p.min);
      if (p.options) expect(p.options.length, p.id).toBeGreaterThanOrEqual(p.max - p.min + 1);
    }
  });
});

describe.skipIf(patches.length === 0)('parameter map against real patches', () => {
  it('decode → encode round-trips every real patch byte-for-byte', () => {
    for (const { data } of patches) expect(encode(data, decode(data))).toEqual(data);
  });

  it('every value in every real patch is inside its parameter range', () => {
    const outside: string[] = [];
    for (const { data, slot } of patches) {
      const values = decode(data);
      for (const p of MAPPED) {
        const v = values[p.id];
        if (v < p.min || v > p.max) outside.push(`${p.id}=${v} (range ${p.min}–${p.max}) in ${slot}`);
      }
    }
    // Group by parameter so a wrong offset or range shows up once, with how widespread it is.
    const byParam = new Map<string, string[]>();
    for (const o of outside) byParam.set(o.split('=')[0], [...(byParam.get(o.split('=')[0]) ?? []), o]);
    expect([...byParam].map(([id, list]) => `${id}: ${list.length} patches, e.g. ${list[0]}`)).toEqual([]);
  });

  it('changing one parameter changes only that parameter', () => {
    const { data } = patches[0];
    for (const p of MAPPED) {
      const before = decode(data)[p.id];
      const changed = encode(data, { [p.id]: before === p.max ? p.min : p.max });
      expect(diff(data, changed)).toEqual([p.id]);
    }
  });
});
