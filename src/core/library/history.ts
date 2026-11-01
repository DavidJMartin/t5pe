// A patch's version timeline (design.md §3.3): every moment a version became the current one, newest first.
// Built from the append-only 'edit' provenance events (patch X replaced patch Y at time T), so restoring an old
// version adds an entry instead of rewriting anything.
import type { Patch, Provenance, VersionAction } from './types';

export interface HistoryEntry {
  patchId: string;
  at: number;
  /** 'original' = how the first version arrived (synth read, backup, file). */
  action: VersionAction | 'original';
  /** Where the original came from (e.g. the backup file name). */
  source: string;
  /** The top entry: the version the library currently shows. */
  current: boolean;
}

type PatchLike = Pick<Patch, 'id' | 'createdAt' | 'supersededBy'>;

export function versionHistory(patchId: string, patches: readonly PatchLike[], provenance: readonly Provenance[]): HistoryEntry[] {
  const byId = new Map(patches.map((p) => [p.id, p]));
  const events = provenance.filter((e) => e.kind === 'edit');
  // Versions are linked by "replaced" events. Edits saved before those were recorded only have the
  // supersededBy link, so that counts as a link too.
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };
  for (const e of events) if (e.replaced) link(e.patchId, e.replaced);
  for (const p of patches) if (p.supersededBy) link(p.id, p.supersededBy);

  const family = new Set([patchId]);
  const queue = [patchId];
  while (queue.length) {
    for (const next of links.get(queue.shift()!) ?? []) {
      if (!family.has(next)) {
        family.add(next);
        queue.push(next);
      }
    }
  }

  // A version event: this patch became current by replacing another. Edits saved before events recorded
  // `replaced` are recognised by their source text, which only Library.update writes (supersededBy links
  // can't be used: restoring rewrites them).
  const isVersionEvent = (e: Provenance) => e.kind === 'edit' && (!!e.replaced || /^(updated|renamed|restored)/.test(e.source));
  // `seq` breaks ties between events recorded in the same millisecond: later-recorded is newer.
  const entries: (Omit<HistoryEntry, 'current'> & { seq: number })[] = [];
  for (const [seq, e] of provenance.entries()) {
    if (!family.has(e.patchId) || !isVersionEvent(e)) continue;
    entries.push({ patchId: e.patchId, at: e.at, action: e.action ?? (e.source.startsWith('renamed') ? 'rename' : 'update'), source: e.source, seq: e.id ?? seq });
  }
  // The first version: the earliest way any family member arrived (synth read, backup, file, or "save as new").
  const arrivals = provenance.filter((p) => family.has(p.patchId) && !isVersionEvent(p)).sort((a, b) => a.at - b.at);
  if (arrivals[0]) entries.push({ patchId: arrivals[0].patchId, at: arrivals[0].at, action: 'original', source: arrivals[0].source, seq: -1 });

  entries.sort((a, b) => b.at - a.at || b.seq - a.seq);
  const currentId = [...family].find((id) => byId.get(id) && !byId.get(id)!.supersededBy);
  return entries.map(({ seq: _seq, ...e }, i) => ({ ...e, current: i === 0 && e.patchId === currentId }));
}

/** The version the library currently shows for this patch's family. */
export function currentVersion(patchId: string, patches: readonly PatchLike[]): string {
  const byId = new Map(patches.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let id = patchId;
  while (byId.get(id)?.supersededBy && !seen.has(id)) {
    seen.add(id);
    id = byId.get(id)!.supersededBy!;
  }
  return id;
}
