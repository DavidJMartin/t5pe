import { describe, expect, it } from 'vitest';
import { currentVersion, versionHistory } from './history';
import type { Provenance } from './types';

const imported = (patchId: string, at: number): Provenance => ({ patchId, kind: 'synth', source: 'Backup x.syx', bank: 0, prog: 0, at });
const edit = (patchId: string, replaced: string, at: number, action: 'update' | 'rename' | 'restore'): Provenance => ({
  patchId, kind: 'edit', source: action, at, replaced, action,
});

describe('versionHistory', () => {
  it('lists every version newest first, with the original at the bottom', () => {
    const patches = [{ id: 'A', createdAt: 1, supersededBy: 'B' }, { id: 'B', createdAt: 2, supersededBy: 'C' }, { id: 'C', createdAt: 3 }];
    const prov = [imported('A', 1), edit('B', 'A', 2, 'update'), edit('C', 'B', 3, 'rename')];
    const h = versionHistory('C', patches, prov);
    expect(h.map((e) => [e.patchId, e.action, e.current])).toEqual([['C', 'rename', true], ['B', 'update', false], ['A', 'original', false]]);
    // Same timeline from any version in it.
    expect(versionHistory('A', patches, prov)).toEqual(h);
  });

  it('restoring an old version adds a new top entry and keeps the replaced version below it', () => {
    // A → B → C, then A restored at t=4: C now points at A, A is current again.
    const patches = [{ id: 'A', createdAt: 1 }, { id: 'B', createdAt: 2, supersededBy: 'C' }, { id: 'C', createdAt: 3, supersededBy: 'A' }];
    const prov = [imported('A', 1), edit('B', 'A', 2, 'update'), edit('C', 'B', 3, 'update'), edit('A', 'C', 4, 'restore')];
    const h = versionHistory('A', patches, prov);
    expect(h.map((e) => [e.patchId, e.at, e.action, e.current])).toEqual([
      ['A', 4, 'restore', true],
      ['C', 3, 'update', false],
      ['B', 2, 'update', false],
      ['A', 1, 'original', false],
    ]);
    expect(currentVersion('B', patches)).toBe('A');
  });

  it('a patch with no versions has just its original entry, including one made by "save as new"', () => {
    expect(versionHistory('A', [{ id: 'A', createdAt: 1 }], [imported('A', 1)]).map((e) => e.action)).toEqual(['original']);
    const savedAsNew: Provenance = { patchId: 'N', kind: 'edit', source: 'edited from "A"', at: 5 };
    expect(versionHistory('N', [{ id: 'N', createdAt: 5 }], [savedAsNew]).map((e) => [e.action, e.source])).toEqual([['original', 'edited from "A"']]);
  });

  it('keeps older (unrecorded) updates in the timeline after a restore rewrites the links', () => {
    // O → v2 → v3 saved the old way, then O restored the new way: O no longer points at v2.
    const patches = [{ id: 'O', createdAt: 1 }, { id: 'v2', createdAt: 2, supersededBy: 'v3' }, { id: 'v3', createdAt: 3, supersededBy: 'O' }];
    const prov: Provenance[] = [
      imported('O', 1),
      { patchId: 'v2', kind: 'edit', source: 'updated in the editor', at: 2 },
      { patchId: 'v3', kind: 'edit', source: 'updated in the editor', at: 3 },
      edit('O', 'v3', 4, 'restore'),
    ];
    expect(versionHistory('O', patches, prov).map((e) => [e.patchId, e.action])).toEqual([
      ['O', 'restore'],
      ['v3', 'update'],
      ['v2', 'update'],
      ['O', 'original'],
    ]);
  });

  it('understands updates saved before version events recorded what they replaced', () => {
    const patches = [{ id: 'A', createdAt: 1, supersededBy: 'B' }, { id: 'B', createdAt: 2 }];
    const prov: Provenance[] = [imported('A', 1), { patchId: 'B', kind: 'edit', source: 'updated in the editor', at: 2 }];
    expect(versionHistory('B', patches, prov).map((e) => [e.patchId, e.action])).toEqual([['B', 'update'], ['A', 'original']]);
  });
});
