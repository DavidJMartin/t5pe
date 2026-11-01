import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseSyx } from '../core/library/import';
import { parseTake5 } from '../core/sysex/messages';
import { fakeProgramDump } from '../core/sysex/testdata';
import { LibraryFolder, type FolderStatus } from './folder';
import { Library } from './library';

// In-memory stand-in for the File System Access API.
class FakeDir {
  readonly kind = 'directory';
  name: string;
  files = new Map<string, Uint8Array>();
  dirs = new Map<string, FakeDir>();
  constructor(name: string) {
    this.name = name;
  }
  async getDirectoryHandle(name: string) {
    if (!this.dirs.has(name)) this.dirs.set(name, new FakeDir(name));
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!opts?.create && !this.files.has(name)) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });
    return {
      kind: 'file',
      getFile: async () => {
        const bytes = this.files.get(name)!;
        return { text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
      },
      createWritable: async () => {
        let data = new Uint8Array();
        return { write: async (d: Uint8Array) => void (data = Uint8Array.from(d)), close: async () => void this.files.set(name, data) };
      },
    };
  }
  async *entries() {
    for (const [name] of this.files) yield [name, { kind: 'file' }];
    for (const [name, dir] of this.dirs) yield [name, dir];
  }
  async queryPermission() {
    return 'granted';
  }
  text(name: string) {
    return new TextDecoder().decode(this.files.get(name));
  }
}

let n = 0;
const tick = () => new Promise((r) => setTimeout(r, 5));
const patch = (bank: number, prog: number, name: string) => {
  const m = parseTake5(fakeProgramDump(bank, prog, name));
  if (m?.kind !== 'programDump') throw new Error();
  return { data: m.data, bank, prog };
};

/** One copy of the app: its own browser storage, opening a (possibly shared) folder. */
async function open(root: FakeDir) {
  const library = new Library(`folder-${n++}`);
  const statuses: FolderStatus[] = [];
  const folder = new LibraryFolder(library, (s) => statuses.push(s));
  await folder.useFolder(root as unknown as FileSystemDirectoryHandle);
  const last = () => statuses.at(-1)!;
  const byName = async (name: string) => (await library.all()).find((p) => p.name === name)!;
  return { library, folder, last, byName };
}

async function seeded() {
  const root = new FakeDir('Take5 Library');
  const a = await open(root);
  await a.library.importPatches([patch(0, 0, 'Alpha'), patch(16, 1, 'Beta')], { kind: 'synth', source: 'Read synth 1', at: 1, snapshot: true });
  await a.folder.syncNow();
  return { root, a };
}

describe('LibraryFolder', () => {
  it('writes importable .syx files, the snapshot and the index', async () => {
    const { root, a } = await seeded();
    const patches = root.dirs.get('patches')!;
    expect([...patches.files.values()].flatMap((b) => parseSyx(b).patches.map((p) => p.name)).sort()).toEqual(['Alpha', 'Beta']);
    const [snapshot] = root.dirs.get('snapshots')!.files.values();
    expect(parseSyx(snapshot).patches.map((p) => [p.name, p.bank, p.prog])).toEqual([['Alpha', 0, 0], ['Beta', 16, 1]]);
    const index = JSON.parse(root.text('library.json'));
    expect(index.patches.map((p: { name: string }) => p.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(index.patches[0].data).toBeUndefined();
    expect(root.dirs.get('history')!.files.size).toBe(1);
    expect(a.last().state).toBe('ok');
  });

  it('a fresh browser opening the folder gets everything back', async () => {
    const { root, a } = await seeded();
    const alpha = await a.byName('Alpha');
    await a.library.setHearted(alpha.id, true);
    await a.library.rename(alpha.id, 'Alpha 2');
    await a.folder.syncNow();

    const b = await open(root); // e.g. another port, or the hosted site
    const last = b.last();
    expect(last.state === 'ok' && last.last).toMatchObject({ loaded: 3, problems: [] });
    const renamed = await b.byName('Alpha 2');
    const original = await b.byName('Alpha');
    expect(renamed).toMatchObject({ hearted: true, parentIds: [original.id] });
    expect(original.supersededBy).toBe(renamed.id);
    expect(original.provenance.map((p) => [p.source, p.bank, p.prog])).toEqual([['Read synth 1', 0, 0]]);
    expect((await b.library.snapshots()).map((s) => s.id)).toEqual(['Read synth 1']);
  });

  it('keeps two copies of the app in step through a shared folder; the newer change wins', async () => {
    const { root, a } = await seeded();
    const b = await open(root);
    const beta = await b.byName('Beta');

    await tick();
    await b.library.setHearted(beta.id, true);
    await b.folder.syncNow();
    await a.folder.syncNow();
    expect((await a.byName('Beta')).hearted).toBe(true);

    await tick();
    await a.library.setHearted(beta.id, false);
    await a.folder.syncNow();
    await b.folder.syncNow();
    expect((await b.byName('Beta')).hearted).toBe(false);

    // Patches only ever accumulate: one added in each copy ends up in both.
    await a.library.importPatches([patch(1, 0, 'From A')], { kind: 'file', source: 'a.syx', at: 2 });
    await b.library.importPatches([patch(1, 1, 'From B')], { kind: 'file', source: 'b.syx', at: 3 });
    await a.folder.syncNow();
    await b.folder.syncNow();
    await a.folder.syncNow();
    for (const copy of [a, b]) expect((await copy.library.all()).map((p) => p.name).sort()).toEqual(['Alpha', 'Beta', 'From A', 'From B']);
  });

  it('falls back to the daily copy when library.json is damaged', async () => {
    const { root } = await seeded();
    root.files.set('library.json', new TextEncoder().encode('{ not json'));
    const b = await open(root);
    const last = b.last();
    expect(last.state === 'ok' && last.last.loaded).toBe(2);
    expect(last.state === 'ok' && last.last.problems.join(' ')).toMatch(/library\.json is damaged/);
    expect(JSON.parse(root.text('library.json')).patches.length).toBe(2); // repaired
  });

  it('recovers every patch from its .syx file when there is no index at all', async () => {
    const { root } = await seeded();
    root.files.delete('library.json');
    root.dirs.get('history')!.files.clear();
    const b = await open(root);
    expect((await b.library.all()).map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
    const last = b.last();
    expect(last.state === 'ok' && last.last.unindexed).toBe(2);
  });

  it('rejects a patch file that does not match its id', async () => {
    const { root } = await seeded();
    const patches = root.dirs.get('patches')!;
    const [alphaFile] = [...patches.files.keys()].filter((f) => f.endsWith('Alpha.syx'));
    const [betaFile] = [...patches.files.keys()].filter((f) => f.endsWith('Beta.syx'));
    patches.files.set(alphaFile, patches.files.get(betaFile)!); // Alpha's file now holds Beta
    const b = await open(root);
    const last = b.last();
    expect(last.state === 'ok' && last.last.problems.join(' ')).toMatch(/"Alpha".*doesn't match/);
    expect((await b.library.all()).map((p) => p.name)).toEqual(['Beta']);
    // The index still lists Alpha, so another copy that has it (or a repaired file) isn't lost.
    expect(JSON.parse(root.text('library.json')).patches.map((p: { name: string }) => p.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('keeps index entries whose file is temporarily missing', async () => {
    const { root } = await seeded();
    const patches = root.dirs.get('patches')!;
    const [alphaFile] = [...patches.files.keys()].filter((f) => f.endsWith('Alpha.syx'));
    const alphaBytes = patches.files.get(alphaFile)!;
    patches.files.delete(alphaFile); // e.g. not downloaded from iCloud yet
    const b = await open(root);
    expect((await b.library.all()).map((p) => p.name)).toEqual(['Beta']);
    patches.files.set(alphaFile, alphaBytes); // it arrives later
    await b.folder.syncNow();
    expect((await b.library.all()).map((p) => p.name).sort()).toEqual(['Alpha', 'Beta']);
  });
});
