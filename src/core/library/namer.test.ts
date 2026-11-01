import { describe, expect, it } from 'vitest';
import { suggestName } from './namer';

const id = (n: number) => n.toString(16).padStart(8, '0') + 'ab'.repeat(28);

describe('suggestName', () => {
  it('is two words, fits the 20-character name, printable ASCII', () => {
    for (let i = 1; i < 500; i++) {
      const name = suggestName(id(i * 7919), null, new Set());
      expect(name.split(' ')).toHaveLength(2);
      expect(name.length).toBeLessThanOrEqual(20);
      expect(name).toMatch(/^[ -~]+$/);
    }
  });

  it('is deterministic per patch, and "another" gives a different name', () => {
    const a = suggestName(id(42), 'pad', new Set());
    expect(suggestName(id(42), 'pad', new Set())).toBe(a);
    const b = suggestName(id(42), 'pad', new Set(), 1);
    expect(b).not.toBe(a);
  });

  it('never returns a name already taken (case-insensitive)', () => {
    const first = suggestName(id(7), null, new Set());
    const next = suggestName(id(7), null, new Set([first.toUpperCase()]));
    expect(next).not.toBe(first);
  });

  it('gives a library of hundreds of patches distinct names', () => {
    const taken = new Set<string>();
    for (let i = 1; i <= 500; i++) taken.add(suggestName(id(i * 104729), i % 2 ? 'pad' : 'bass', taken));
    expect(taken.size).toBe(500);
  });
});

