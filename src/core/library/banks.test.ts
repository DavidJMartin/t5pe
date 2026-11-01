import { describe, expect, it } from 'vitest';
import { currentSynthSlots, INIT, planChanges, setPlanned } from './banks';

describe('currentSynthSlots', () => {
  it('takes each slot from the latest snapshot that covered it', () => {
    const slots = currentSynthSlots([
      { id: 'push', takenAt: 3, source: 'After push', slots: { '0:1': 'Y' } },
      { id: 'backup', takenAt: 1, source: 'Backup', slots: { '0:0': 'A', '0:1': 'B' } },
    ]);
    expect(Object.fromEntries(slots)).toEqual({ '0:0': 'A', '0:1': 'Y' });
  });
});

describe('planChanges', () => {
  const synth = new Map([['0:0', 'A'], ['0:1', 'B'], ['16:0', 'F']]);

  it('lists only slots that would change, resolving Init', () => {
    const changes = planChanges({ '0:0': 'A', '0:1': INIT, '0:2': 'C' }, synth, 'I');
    expect(changes.map((c) => [c.key, c.from, c.to])).toEqual([['0:1', 'B', 'I'], ['0:2', undefined, 'C']]);
  });

  it('never includes factory banks, and skips Init until an Init patch is known', () => {
    expect(planChanges({ '16:0': 'X' }, synth, 'I')).toEqual([]);
    expect(planChanges({ '0:1': INIT }, synth, null)).toEqual([]);
  });
});

describe('setPlanned', () => {
  const synth = new Map([['0:0', 'A']]);
  it('removes entries that match the synth, and on revert (null)', () => {
    expect(setPlanned({}, '0:0', 'B', synth, null)).toEqual({ '0:0': 'B' });
    expect(setPlanned({ '0:0': 'B' }, '0:0', 'A', synth, null)).toEqual({});
    expect(setPlanned({ '0:0': 'B' }, '0:0', null, synth, null)).toEqual({});
    expect(setPlanned({}, '0:0', INIT, synth, 'A')).toEqual({});
  });
});
