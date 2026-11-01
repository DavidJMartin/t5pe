// IndexedDB library (design.md §3.3, §4.3). There is deliberately no delete: patches are immutable,
// edits create new patches with lineage, and "delete" means moving to the bin.
import Dexie, { type Table } from 'dexie';
import { patchId, soundHash } from '../core/patch/hash';
import { readName, writeName } from '../core/patch/name';
import type { Patch, Provenance, ProvenanceKind, Snapshot, VersionAction } from '../core/library/types';
import { slotKey } from '../core/library/slots';

class LibraryDb extends Dexie {
  patches!: Table<Patch, string>;
  provenance!: Table<Provenance, number>;
  snapshots!: Table<Snapshot, string>;
  settings!: Table<{ key: string; value: unknown }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      patches: 'id, soundHash, createdAt',
      provenance: '++id, patchId, source',
      snapshots: 'id, takenAt',
      settings: 'key',
    });
  }
}

export interface IncomingPatch {
  data: Uint8Array;
  bank?: number;
  prog?: number;
}

export interface ImportSource {
  kind: Exclude<ProvenanceKind, 'edit' | 'generated'>;
  /** File name or "Read synth <date>". Re-importing the same source is a no-op. */
  source: string;
  at: number;
  /** Record a snapshot of the synth's slots (synth reads and synth backups). */
  snapshot?: boolean;
}

export interface ImportSummary {
  total: number;
  added: number;
  alreadyInLibrary: number;
}

export interface PatchWithProvenance extends Patch {
  provenance: Provenance[];
}

/** A patch as recorded in a library folder's index (everything but the data, which is in its .syx file). */
export type IndexedPatch = Omit<Patch, 'data'> & { provenance: Provenance[]; file?: string };

export interface MergeSummary {
  added: number;
  updated: number;
  /** Index entries that couldn't be loaded, with the reason. */
  problems: string[];
}

// Only real changes count: a patch that was merely imported later elsewhere mustn't override a heart set here.
const stamp = (p: { updatedAt?: number }) => p.updatedAt ?? 0;
const provenanceKey = (p: Provenance) => `${p.patchId}|${p.kind}|${p.source}|${p.bank}|${p.prog}|${p.at}`;

export class Library {
  readonly db: LibraryDb;
  private listeners = new Set<() => void>();

  constructor(name = 'take5-library') {
    this.db = new LibraryDb(name);
  }

  /** Called after every change (the folder mirror subscribes to this). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async importPatches(items: IncomingPatch[], src: ImportSource): Promise<ImportSummary> {
    const prepared = await Promise.all(
      items.map(async (item) => ({ ...item, id: await patchId(item.data), soundHash: await soundHash(item.data) })),
    );
    let added = 0;
    await this.db.transaction('rw', this.db.patches, this.db.provenance, this.db.snapshots, async () => {
      const existing = new Set((await this.db.patches.bulkGet(prepared.map((p) => p.id))).filter((p) => p).map((p) => p!.id));
      const seenProvenance = new Set(
        (await this.db.provenance.where('source').equals(src.source).toArray()).map((p) => `${p.patchId}|${p.bank}|${p.prog}`),
      );
      const now = Date.now();
      for (const p of prepared) {
        if (!existing.has(p.id)) {
          await this.db.patches.add({ id: p.id, soundHash: p.soundHash, data: p.data, name: readName(p.data), parentIds: [], createdAt: now, hearted: false });
          existing.add(p.id);
          added++;
        }
        const key = `${p.id}|${p.bank}|${p.prog}`;
        if (seenProvenance.has(key)) continue;
        seenProvenance.add(key);
        await this.db.provenance.add({ patchId: p.id, kind: src.kind, source: src.source, bank: p.bank, prog: p.prog, at: src.at });
      }
      if (src.snapshot) {
        const slots: Record<string, string> = {};
        for (const p of prepared) if (p.bank !== undefined && p.prog !== undefined) slots[slotKey(p.bank, p.prog)] = p.id;
        await this.db.snapshots.put({ id: src.source, takenAt: src.at, source: src.source, slots });
      }
    });
    this.changed();
    return { total: items.length, added, alreadyInLibrary: items.length - added };
  }

  async all(): Promise<PatchWithProvenance[]> {
    const [patches, provenance] = await Promise.all([this.db.patches.toArray(), this.db.provenance.toArray()]);
    const byPatch = new Map<string, Provenance[]>();
    for (const p of provenance) byPatch.set(p.patchId, [...(byPatch.get(p.patchId) ?? []), p]);
    return patches.map((p) => ({ ...p, provenance: byPatch.get(p.id) ?? [] }));
  }

  async snapshots(): Promise<Snapshot[]> {
    return this.db.snapshots.orderBy('takenAt').toArray();
  }

  /**
   * Folds another copy of the library (a library folder) into this one. Nothing is ever removed:
   * unknown patches are added (after checking their data matches their id), history and snapshots
   * are combined, and for hearts/bin/rename state the more recently changed copy wins.
   */
  async merge(entries: IndexedPatch[], snapshots: Snapshot[], loadData: (entry: IndexedPatch) => Promise<Uint8Array | null>): Promise<MergeSummary> {
    const problems: string[] = [];
    const existing = new Map((await this.db.patches.bulkGet(entries.map((e) => e.id))).filter((p) => p).map((p) => [p!.id, p!]));
    const incoming: Patch[] = [];
    for (const e of entries) {
      if (existing.has(e.id)) continue;
      const data = await loadData(e).catch(() => null);
      if (!data) {
        problems.push(`"${e.name}": its .syx file is missing or unreadable`);
        continue;
      }
      if ((await patchId(data)) !== e.id) {
        problems.push(`"${e.name}": its .syx file doesn't match the index, skipped`);
        continue;
      }
      incoming.push({
        id: e.id,
        soundHash: await soundHash(data),
        data,
        name: readName(data),
        parentIds: e.parentIds ?? [],
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        hearted: !!e.hearted,
        binnedAt: e.binnedAt,
        supersededBy: e.supersededBy,
      });
    }
    let added = 0;
    let updated = 0;
    let other = 0;
    await this.db.transaction('rw', this.db.patches, this.db.provenance, this.db.snapshots, async () => {
      for (const p of incoming) {
        await this.db.patches.add(p);
        added++;
      }
      for (const e of entries) {
        const mine = existing.get(e.id);
        if (!mine || stamp(e) <= stamp(mine)) continue;
        await this.db.patches.update(e.id, {
          hearted: !!e.hearted,
          binnedAt: e.binnedAt,
          supersededBy: e.supersededBy,
          updatedAt: e.updatedAt,
          parentIds: [...new Set([...mine.parentIds, ...(e.parentIds ?? [])])],
        });
        updated++;
      }
      const known = new Set((await this.db.provenance.toArray()).map(provenanceKey));
      const loaded = new Set([...existing.keys(), ...incoming.map((p) => p.id)]);
      for (const e of entries) {
        if (!loaded.has(e.id)) continue;
        for (const { id: _id, ...p } of e.provenance ?? []) {
          if (known.has(provenanceKey(p))) continue;
          known.add(provenanceKey(p));
          await this.db.provenance.add(p);
          other++;
        }
      }
      for (const s of snapshots) {
        if (await this.db.snapshots.get(s.id)) continue;
        await this.db.snapshots.add(s);
        other++;
      }
    });
    if (added || updated || other) this.changed();
    return { added, updated, problems };
  }

  async setHearted(id: string, hearted: boolean): Promise<void> {
    await this.db.patches.update(id, { hearted, updatedAt: Date.now() });
    this.changed();
  }

  /** Renaming is an update that only changes the name. */
  async rename(id: string, name: string): Promise<string> {
    const original = await this.db.patches.get(id);
    if (!original) throw new Error(`no patch ${id}`);
    return this.update(id, writeName(original.data, name), `renamed from "${original.name}"`, 'rename');
  }

  /**
   * "Overwrite" without losing anything: the new data becomes a new patch that takes the original's place
   * in the library (same heart; the list shows only the new version), and the original is kept, marked
   * superseded, as its history. Returns the new id (the same id if nothing changed).
   */
  async update(id: string, data: Uint8Array, source: string, action: VersionAction = 'update'): Promise<string> {
    const original = await this.db.patches.get(id);
    if (!original) throw new Error(`no patch ${id}`);
    const newId = await patchId(data);
    if (newId === id) return id;
    const sound = await soundHash(data);
    await this.db.transaction('rw', this.db.patches, this.db.provenance, async () => {
      if (!(await this.db.patches.get(newId))) {
        await this.db.patches.add({
          id: newId,
          soundHash: sound,
          data: Uint8Array.from(data),
          name: readName(data),
          parentIds: [id],
          createdAt: Date.now(),
          hearted: original.hearted,
        });
      }
      const now = Date.now();
      await this.db.patches.update(newId, { supersededBy: undefined, binnedAt: undefined, updatedAt: now });
      await this.db.patches.update(id, { supersededBy: newId, updatedAt: now });
      // A permanent event: the version timeline is built from these, never from the mutable supersededBy links.
      await this.db.provenance.add({ patchId: newId, kind: 'edit', source, at: now, replaced: id, action });
    });
    this.changed();
    return newId;
  }

  /**
   * Makes an earlier version current again. It's recorded as a new event at the top of the timeline; the
   * version being replaced stays in the history. `currentId` is the version currently shown in the list.
   */
  async restoreVersion(currentId: string, versionId: string): Promise<string> {
    const version = await this.db.patches.get(versionId);
    if (!version) throw new Error(`no patch ${versionId}`);
    return this.update(currentId, version.data, 'restored an earlier version', 'restore');
  }

  /**
   * Saves a sound (an edited edit buffer, later a generated or mutated patch) as a library patch whose
   * parents are the patches it came from. Returns its id; keeping an identical sound twice is a no-op.
   */
  async keep(data: Uint8Array, parentIds: string[], source: string, kind: 'edit' | 'generated' = 'edit'): Promise<{ id: string; isNew: boolean }> {
    const id = await patchId(data);
    const sound = await soundHash(data);
    let isNew = false;
    await this.db.transaction('rw', this.db.patches, this.db.provenance, async () => {
      if (await this.db.patches.get(id)) return;
      const now = Date.now();
      await this.db.patches.add({ id, soundHash: sound, data: Uint8Array.from(data), name: readName(data), parentIds, createdAt: now, updatedAt: now, hearted: false });
      await this.db.provenance.add({ patchId: id, kind, source, at: now });
      isNew = true;
    });
    if (isNew) this.changed();
    return { id, isNew };
  }

  async bin(id: string): Promise<void> {
    await this.db.patches.update(id, { binnedAt: Date.now(), updatedAt: Date.now() });
    this.changed();
  }

  async restore(id: string): Promise<void> {
    await this.db.patches.update(id, { binnedAt: undefined, updatedAt: Date.now() });
    this.changed();
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return (await this.db.settings.get(key))?.value as T | undefined;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }
}

/** Ask the browser not to evict the library under storage pressure (design.md §3.3). */
export async function requestPersistentStorage(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false;
}
