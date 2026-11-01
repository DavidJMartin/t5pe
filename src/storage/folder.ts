// The library folder: the durable home of the library (design.md §2, "Library durability").
// The browser's IndexedDB is a working copy. Every sync reads the folder, merges it in, then writes
// back whatever the folder is missing, so any copy of the app (another port, the hosted site) that
// opens the same folder sees the same library. Nothing in the folder is ever deleted.
//
//   <folder>/patches/<id prefix> <name>.syx   one edit-buffer dump per patch (safe to send: never writes flash)
//   <folder>/snapshots/<source>.syx           program dumps of a synth read, in slot order
//   <folder>/library.json                     names, hearts, lineage, provenance, snapshots
//   <folder>/history/library-YYYY-MM-DD.json  that day's last index; used if library.json is damaged
import { parseSyx } from '../core/library/import';
import type { Snapshot } from '../core/library/types';
import { editBufferDump, programDump } from '../core/sysex/messages';
import type { IndexedPatch, Library } from './library';

const HANDLE_KEY = 'mirrorFolder';
const FORMAT = 'take5-library';

export interface SyncResult {
  /** Patches this sync loaded from the folder into the browser. */
  loaded: number;
  /** Patches whose hearts/bin/rename state came from the folder. */
  updated: number;
  /** .syx files in patches/ the index didn't list, imported so nothing is lost. */
  unindexed: number;
  problems: string[];
}

export type FolderStatus =
  | { state: 'unsupported' }
  | { state: 'none' }
  | { state: 'needs-permission'; folder: string }
  | { state: 'syncing'; folder: string }
  | { state: 'ok'; folder: string; at: number; last: SyncResult }
  | { state: 'error'; folder: string; message: string };

interface IndexFile {
  format: typeof FORMAT;
  version: 1;
  writtenAt: string;
  patches: IndexedPatch[];
  snapshots: Snapshot[];
}

export class LibraryFolder {
  status: FolderStatus = { state: 'none' };
  private handle?: FileSystemDirectoryHandle;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private again = false;
  private readonly library: Library;
  private readonly onStatus: (status: FolderStatus) => void;

  constructor(library: Library, onStatus: (status: FolderStatus) => void) {
    this.library = library;
    this.onStatus = onStatus;
    library.onChange(() => this.schedule());
  }

  static get supported(): boolean {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  /** Reopens the folder chosen in an earlier session. Browsers ask for a click to re-grant access after a restart. */
  async init(): Promise<void> {
    if (!LibraryFolder.supported) return this.set({ state: 'unsupported' });
    const handle = await this.library.getSetting<FileSystemDirectoryHandle>(HANDLE_KEY);
    if (!handle) return this.set({ state: 'none' });
    this.handle = handle;
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') await this.syncNow();
    else this.set({ state: 'needs-permission', folder: handle.name });
  }

  /** Opens a folder: an existing library folder is loaded and merged; an empty one is filled. Must be called from a click. */
  async choose(): Promise<void> {
    await this.useFolder(await window.showDirectoryPicker!({ id: 'take5-library', mode: 'readwrite' }));
  }

  async useFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    await this.library.setSetting(HANDLE_KEY, handle);
    this.handle = handle;
    await this.syncNow();
  }

  /** Must be called from a click. */
  async reconnect(): Promise<void> {
    if (!this.handle) return;
    if ((await this.handle.requestPermission({ mode: 'readwrite' })) === 'granted') await this.syncNow();
  }

  private schedule(): void {
    if (this.status.state !== 'ok' && this.status.state !== 'syncing' && this.status.state !== 'error') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), 500);
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.sync().finally(() => {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  private async sync(): Promise<void> {
    const root = this.handle;
    if (!root) return;
    this.set({ state: 'syncing', folder: root.name });
    try {
      const patchesDir = await root.getDirectoryHandle('patches', { create: true });
      const snapshotsDir = await root.getDirectoryHandle('snapshots', { create: true });
      const historyDir = await root.getDirectoryHandle('history', { create: true });
      const patchFiles = await fileNames(patchesDir);
      const snapshotFiles = await fileNames(snapshotsDir);
      const result: SyncResult = { loaded: 0, updated: 0, unindexed: 0, problems: [] };

      // 1. Read the folder's index (falling back to the newest daily copy) and merge it in.
      const { index, from, problems } = await readIndex(root, historyDir);
      result.problems.push(...problems);
      const byPrefix = new Map([...patchFiles].map((f) => [f.slice(0, 12), f]));
      if (index) {
        const merged = await this.library.merge(index.patches, index.snapshots ?? [], async (e) => {
          const file = e.file?.startsWith('patches/') ? e.file.slice('patches/'.length) : byPrefix.get(e.id.slice(0, 12));
          return file && patchFiles.has(file) ? readPatchFile(patchesDir, file) : null;
        });
        result.loaded = merged.added;
        result.updated = merged.updated;
        result.problems.push(...merged.problems);
        if (from !== 'library.json') result.problems.push(`library.json was unreadable; loaded ${from} instead`);
      }

      // 2. Any patch file the library doesn't know (e.g. the index was lost) is imported, so nothing in the folder is ever ignored.
      const known = new Set((await this.library.all()).map((p) => p.id.slice(0, 12)));
      for (const file of patchFiles) {
        if (known.has(file.slice(0, 12))) continue;
        const data = await readPatchFile(patchesDir, file).catch(() => null);
        if (!data) {
          result.problems.push(`patches/${file} is not a Take 5 patch`);
          continue;
        }
        const summary = await this.library.importPatches([{ data }], { kind: 'file', source: 'Library folder (not in index)', at: Date.now() });
        result.unindexed += summary.added;
      }

      // 3. Write whatever the folder is missing, then the merged index.
      const patches = await this.library.all();
      const files: Record<string, string> = {};
      for (const p of patches) {
        const file = patchFileName(p.id, p.name);
        files[p.id] = `patches/${file}`;
        if (!patchFiles.has(file)) await writeFile(patchesDir, file, editBufferDump(p.data));
      }
      const snapshots = await this.library.snapshots();
      const byId = new Map(patches.map((p) => [p.id, p]));
      for (const s of snapshots) {
        const file = `${safe(s.source)}.syx`;
        if (snapshotFiles.has(file)) continue;
        const dumps = Object.entries(s.slots)
          .map(([slot, id]) => ({ slot: slot.split(':').map(Number), patch: byId.get(id) }))
          .filter((d) => d.patch)
          .sort((a, b) => a.slot[0] - b.slot[0] || a.slot[1] - b.slot[1])
          .map((d) => programDump(d.slot[0], d.slot[1], d.patch!.data));
        await writeFile(snapshotsDir, file, concat(dumps));
      }

      // Entries this browser couldn't load (e.g. a file iCloud hasn't downloaded yet) are carried over unchanged,
      // so the folder's index never forgets a patch.
      const loadedIds = new Set(patches.map((p) => p.id));
      const carried = (index?.patches ?? []).filter((e) => !loadedIds.has(e.id));
      const body = {
        patches: [...patches.map(({ data: _data, provenance, ...meta }) => ({ ...meta, file: files[meta.id], provenance })), ...carried].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
        snapshots,
      };
      if (!index || from !== 'library.json' || JSON.stringify(body) !== JSON.stringify({ patches: index.patches, snapshots: index.snapshots })) {
        const out: IndexFile = { format: FORMAT, version: 1, writtenAt: new Date().toISOString(), ...body };
        const bytes = new TextEncoder().encode(JSON.stringify(out, null, 1));
        await writeFile(root, 'library.json', bytes);
        await writeFile(historyDir, `library-${new Date().toISOString().slice(0, 10)}.json`, bytes);
      }
      this.set({ state: 'ok', folder: root.name, at: Date.now(), last: result });
    } catch (err) {
      this.set({ state: 'error', folder: root.name, message: err instanceof Error ? err.message : String(err) });
    }
  }

  private set(status: FolderStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}

async function readIndex(root: FileSystemDirectoryHandle, historyDir: FileSystemDirectoryHandle): Promise<{ index: IndexFile | null; from: string; problems: string[] }> {
  const problems: string[] = [];
  const candidates = ['library.json', ...[...(await fileNames(historyDir))].filter((f) => f.endsWith('.json')).sort().reverse().map((f) => `history/${f}`)];
  let sawAny = false;
  for (const name of candidates) {
    const dir = name.startsWith('history/') ? historyDir : root;
    const file = name.replace(/^history\//, '');
    let text: string;
    try {
      text = await (await (await dir.getFileHandle(file)).getFile()).text();
    } catch {
      continue; // doesn't exist
    }
    sawAny = true;
    try {
      const parsed = JSON.parse(text) as IndexFile;
      if (parsed.format === FORMAT && Array.isArray(parsed.patches)) return { index: parsed, from: name, problems };
      problems.push(`${name} is not a Take 5 library index`);
    } catch {
      problems.push(`${name} is damaged (not valid JSON)`);
    }
  }
  if (sawAny) problems.push('no readable index found; recovering patches from their .syx files');
  return { index: null, from: '', problems };
}

async function readPatchFile(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
  return parseSyx(bytes).patches[0]?.data ?? null;
}

async function fileNames(dir: FileSystemDirectoryHandle): Promise<Set<string>> {
  const names = new Set<string>();
  for await (const [name, handle] of dir.entries()) if (handle.kind === 'file') names.add(name);
  return names;
}

export function patchFileName(id: string, name: string): string {
  return `${id.slice(0, 12)} ${safe(name) || 'unnamed'}.syx`;
}

function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(bytes as Uint8Array<ArrayBuffer>);
  await w.close();
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
