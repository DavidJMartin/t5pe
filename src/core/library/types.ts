// Library data model (design.md §3.3, §4.3). Patches are immutable and identified by content hash.

export interface Patch {
  /** SHA-256 of `data`. */
  id: string;
  /** SHA-256 with the name blanked. */
  soundHash: string;
  /** Canonical 4096 unpacked bytes. */
  data: Uint8Array;
  name: string;
  /** Lineage: the patch(es) this was made from (rename, edit, generate). */
  parentIds: string[];
  createdAt: number;
  /** Last change to hearted/binnedAt/supersededBy. When two copies of the library disagree, the newer wins. */
  updatedAt?: number;
  hearted: boolean;
  /** Set when moved to the bin. Nothing is ever hard-deleted. */
  binnedAt?: number;
  /** Set when a newer version (e.g. a rename) replaces this one in the list. The patch itself is kept. */
  supersededBy?: string;
}

export type ProvenanceKind = 'synth' | 'file' | 'edit' | 'generated';

/** Where a patch was seen. One patch can have many (same sound in two packs, or in two synth reads). */
export interface Provenance {
  id?: number;
  patchId: string;
  kind: ProvenanceKind;
  /** File name, "Read synth <date>", or "rename". */
  source: string;
  /** Slot it occupied, for synth reads and program-dump files. */
  bank?: number;
  prog?: number;
  at: number;
  /** For kind 'edit': this patch became the current version, replacing `replaced` (design.md §3.3, history). */
  replaced?: string;
  action?: VersionAction;
}

export type VersionAction = 'update' | 'rename' | 'restore';

/** The synth's contents at one moment: slot "bank:prog" → patch id. Immutable. */
export interface Snapshot {
  id: string;
  takenAt: number;
  source: string;
  slots: Record<string, string>;
}
