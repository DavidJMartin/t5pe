import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseTake5 } from '../core/sysex/messages';
import { fakeProgramDump } from '../core/sysex/testdata';
import { Library } from './library';

let n = 0;
const freshLibrary = () => new Library(`test-${n++}`);
const patch = (bank: number, prog: number, name: string) => {
  const m = parseTake5(fakeProgramDump(bank, prog, name));
  if (m?.kind !== 'programDump') throw new Error();
  return { data: m.data, bank, prog };
};

describe('Library', () => {
  it('stores each patch once, with one provenance per source and slot', async () => {
    const lib = freshLibrary();
    const a = patch(0, 0, 'A');
    const first = await lib.importPatches([a, patch(0, 1, 'B')], { kind: 'file', source: 'one.syx', at: 1 });
    expect(first).toEqual({ total: 2, added: 2, alreadyInLibrary: 0 });
    // The same file again is a no-op; the same patch from another file adds provenance only.
    expect((await lib.importPatches([a], { kind: 'file', source: 'one.syx', at: 1 })).added).toBe(0);
    expect((await lib.importPatches([a], { kind: 'file', source: 'two.syx', at: 2 })).added).toBe(0);
    const all = await lib.all();
    expect(all.length).toBe(2);
    expect(all.find((p) => p.name === 'A')!.provenance.map((p) => p.source).sort()).toEqual(['one.syx', 'two.syx']);
  });

  it('records a snapshot of slots for synth reads', async () => {
    const lib = freshLibrary();
    await lib.importPatches([patch(3, 7, 'X'), patch(16, 0, 'Y')], { kind: 'synth', source: 'Read synth', at: 5, snapshot: true });
    const [snap] = await lib.snapshots();
    expect(Object.keys(snap.slots).sort()).toEqual(['16:0', '3:7']);
  });

  it('rename creates a child patch and keeps the original', async () => {
    const lib = freshLibrary();
    await lib.importPatches([patch(0, 0, 'Old')], { kind: 'file', source: 'f.syx', at: 1 });
    const [original] = await lib.all();
    await lib.setHearted(original.id, true);
    const newId = await lib.rename(original.id, 'New');
    const all = await lib.all();
    const renamed = all.find((p) => p.id === newId)!;
    expect(all.length).toBe(2);
    expect(renamed).toMatchObject({ name: 'New', parentIds: [original.id], hearted: true, soundHash: original.soundHash });
    expect(all.find((p) => p.id === original.id)!.supersededBy).toBe(newId);
    expect(await lib.rename(newId, 'New')).toBe(newId); // no-op
  });

  it('keep saves an edited sound with its parent, once', async () => {
    const lib = freshLibrary();
    await lib.importPatches([patch(0, 0, 'Base')], { kind: 'file', source: 'f.syx', at: 1 });
    const [base] = await lib.all();
    const edited = Uint8Array.from(base.data);
    edited[29] = 99;
    const first = await lib.keep(edited, [base.id], 'edited from "Base"');
    expect(first.isNew).toBe(true);
    expect((await lib.keep(edited, [base.id], 'again')).isNew).toBe(false);
    const kept = (await lib.all()).find((p) => p.id === first.id)!;
    expect(kept).toMatchObject({ parentIds: [base.id], name: 'Base' });
    expect(kept.provenance.map((p) => p.kind)).toEqual(['edit']);
  });

  it('update replaces a patch in the list and keeps the original as history', async () => {
    const lib = freshLibrary();
    await lib.importPatches([patch(0, 0, 'Pad')], { kind: 'file', source: 'f.syx', at: 1 });
    const [original] = await lib.all();
    await lib.setHearted(original.id, true);
    const edited = Uint8Array.from(original.data);
    edited[29] = 42;
    const newId = await lib.update(original.id, edited, 'updated in the editor');
    const all = await lib.all();
    const current = all.filter((p) => !p.supersededBy);
    expect(current.map((p) => p.id)).toEqual([newId]);
    expect(current[0]).toMatchObject({ name: 'Pad', hearted: true, parentIds: [original.id] });
    expect(current[0].soundHash).not.toBe(original.soundHash);
    expect(all.find((p) => p.id === original.id)!.supersededBy).toBe(newId);
  });

  it('restoring an old version makes it current and keeps the replaced one in the timeline', async () => {
    const lib = freshLibrary();
    await lib.importPatches([patch(0, 0, 'Lead')], { kind: 'synth', source: 'Backup b.syx', at: 1, snapshot: true });
    const [v1] = await lib.all();
    const v2data = Uint8Array.from(v1.data);
    v2data[29] = 7;
    const v2 = await lib.update(v1.id, v2data, 'updated in the editor');
    const restored = await lib.restoreVersion(v2, v1.id);
    expect(restored).toBe(v1.id);
    const all = await lib.all();
    expect(all.filter((p) => !p.supersededBy).map((p) => p.id)).toEqual([v1.id]);
    const { versionHistory } = await import('../core/library/history');
    const h = versionHistory(v1.id, all, all.flatMap((p) => p.provenance));
    expect(h.map((e) => [e.patchId === v1.id ? 'v1' : 'v2', e.action, e.current])).toEqual([
      ['v1', 'restore', true],
      ['v2', 'update', false],
      ['v1', 'original', false],
    ]);
  });

  it('bins and restores without deleting', async () => {
    const lib = freshLibrary();
    await lib.importPatches([patch(0, 0, 'Bin me')], { kind: 'file', source: 'f.syx', at: 1 });
    const [p] = await lib.all();
    await lib.bin(p.id);
    expect((await lib.all())[0].binnedAt).toBeTypeOf('number');
    await lib.restore(p.id);
    expect((await lib.all())[0].binnedAt).toBeUndefined();
  });

  it('notifies listeners on change', async () => {
    const lib = freshLibrary();
    let calls = 0;
    lib.onChange(() => calls++);
    await lib.importPatches([patch(0, 0, 'A')], { kind: 'file', source: 'f.syx', at: 1 });
    expect(calls).toBe(1);
  });
});
