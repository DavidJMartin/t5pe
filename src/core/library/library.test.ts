import { describe, expect, it } from 'vitest';
import { patchId, soundHash } from '../patch/hash';
import { readName, writeName } from '../patch/name';
import { EDIT_BUFFER_DUMP_LENGTH } from '../sysex/constants';
import { editBufferDump, parseTake5, programDump } from '../sysex/messages';
import { fakeProgramDump } from '../sysex/testdata';
import { guessCategory } from './category';
import { backupDate, parseSyx } from './import';
import { bankLabel, slotLabel } from './slots';

const dataOf = (msg: Uint8Array) => {
  const m = parseTake5(msg);
  if (m?.kind !== 'programDump') throw new Error('not a program dump');
  return m.data;
};

describe('dump builders', () => {
  it('rebuild a program dump byte-for-byte from canonical data', () => {
    const original = fakeProgramDump(4, 11, 'Rebuilt');
    expect(programDump(4, 11, dataOf(original))).toEqual(original);
  });

  it('build an edit buffer dump that parses back to the same data', () => {
    const data = dataOf(fakeProgramDump(0, 0, 'Audition me'));
    const msg = editBufferDump(data);
    expect(msg.length).toBe(EDIT_BUFFER_DUMP_LENGTH);
    const m = parseTake5(msg);
    expect(m?.kind).toBe('editBufferDump');
    expect(m?.kind === 'editBufferDump' && m.data).toEqual(data);
  });

  it('refuse data of the wrong size', () => {
    expect(() => editBufferDump(new Uint8Array(10))).toThrow();
  });
});

describe('names and hashes', () => {
  it('writeName pads, truncates and sanitises without touching other bytes', () => {
    const data = dataOf(fakeProgramDump(0, 0, 'Old'));
    const renamed = writeName(data, 'Brand new name that is too long');
    expect(readName(renamed)).toBe('Brand new name that');
    expect(readName(writeName(data, 'Café'))).toBe('Caf?');
    expect(renamed.filter((b, i) => b !== data[i] && (i < 195 || i >= 215)).length).toBe(0);
  });

  it('a rename changes the id but not the sound hash', async () => {
    const data = dataOf(fakeProgramDump(0, 0, 'Old'));
    const renamed = writeName(data, 'New');
    expect(await patchId(renamed)).not.toBe(await patchId(data));
    expect(await soundHash(renamed)).toBe(await soundHash(data));
    expect(await patchId(data)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseSyx', () => {
  it('keeps program and edit buffer dumps, counts the rest', () => {
    const prog = fakeProgramDump(2, 3, 'Prog');
    const edit = editBufferDump(dataOf(fakeProgramDump(0, 0, 'Edit')));
    const other = Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7);
    const r = parseSyx(Uint8Array.of(...prog, ...other, ...edit));
    expect(r.patches.map((p) => [p.name, p.bank, p.prog])).toEqual([['Prog', 2, 3], ['Edit', undefined, undefined]]);
    expect(r.ignored).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it('recognises backup file names', () => {
    expect(backupDate('take5-2026-10-24-211814.syx')).toEqual(new Date(2026, 9, 24, 21, 18, 14));
    expect(backupDate('take5-2026-10-24-211814-INCOMPLETE.syx')).not.toBeNull();
    expect(backupDate('Factory Set 1.syx')).toBeNull();
  });
});

describe('slots and categories', () => {
  it('labels user and factory banks', () => {
    expect([bankLabel(0), bankLabel(8), bankLabel(9), bankLabel(15), bankLabel(16), bankLabel(31)]).toEqual(['1', '9', 'A', 'G', 'F1', 'F16']);
    expect(slotLabel(10, 6)).toBe('B-07');
  });

  it('guesses categories from names', () => {
    const cases: [string, string | null][] = [
      ['Fly By Bass', 'Bass'], ['Rhodes to Wurly', 'Keys'], ['Neon Pad', 'Pad'], ['Bells Of Bronze', 'Bells'],
      ['T5 Allegro Strings', 'Strings'], ['Matrix Brass', 'Brass'], ['Hyperorgan', 'Organ'], ['Toms', 'Drums'],
      ['Just Anotha 808', 'Drums'], ['Plucks On Tape', 'Pluck'], ['Toaster Lead', 'Lead'], ['3am', null],
      ['Snares', 'Drums'], ['Kix', 'Drums'], ['SplashyArp', 'Arp/Seq'], ['bellarp', 'Bells'],
    ];
    for (const [name, category] of cases) expect([name, guessCategory(name)]).toEqual([name, category]);
  });
});
