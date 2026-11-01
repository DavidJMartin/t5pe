// The Generate panel's state (design.md §3.6–3.7): batches of candidate patches you can audition, keep, or
// mutate further. Candidates live only in memory until kept; kept ones are library patches whose parents
// are what they came from.
import { autoTags } from '../core/library/autotags';
import { suggestName } from '../core/library/namer';
import { breed, fromLibrary, mutate, type GenerateContext } from '../core/generate/generate';
import { decode } from '../core/params/codec';
import { writeName } from '../core/patch/name';
import { pick, rng } from '../core/random';
import type { AppState } from './state.svelte';

export type GenMode = 'library' | 'favourites' | 'mutate';

export interface Candidate {
  key: string;
  data: Uint8Array;
  name: string;
  tags: string[];
  /** How it was made, e.g. 'bred from "A" × "B"'. */
  how: string;
  parents: string[];
  keptId?: string;
}

export class Generator {
  mode = $state<GenMode>('library');
  count = $state(8);
  /** 0–1: how far from its sources a candidate may wander. */
  wildness = $state(0.5);
  /** The sound being mutated (a library patch or an unkept candidate). */
  seed = $state.raw<{ data: Uint8Array; name: string; parents: string[] } | null>(null);
  candidates = $state.raw<Candidate[]>([]);
  playing = $state<string | null>(null);
  private batch = 0;
  private readonly app: AppState;

  constructor(app: AppState) {
    this.app = app;
  }

  get favourites() {
    return this.app.rows.filter((r) => r.hearted && !r.binnedAt && !r.supersededBy);
  }

  private context(): GenerateContext {
    const live = this.app.rows.filter((r) => !r.binnedAt && !r.supersededBy && r.name !== '-');
    return { library: live.map((r) => decode(r.data)) };
  }

  /** Mutate a library patch: opens the panel in mutate mode with this patch as the seed. */
  mutateRow(id: string): void {
    const row = this.app.rows.find((r) => r.id === id);
    if (!row) return;
    this.seed = { data: row.data, name: row.name, parents: [row.id] };
    this.mode = 'mutate';
    this.app.setGenerateOpen(true);
    this.generate();
  }

  /** Branch from a candidate: mutate it further. */
  mutateCandidate(c: Candidate): void {
    this.seed = { data: c.data, name: c.name, parents: c.keptId ? [c.keptId] : c.parents };
    this.mode = 'mutate';
    this.generate();
  }

  generate(): void {
    const ctx = this.context();
    const random = rng((Date.now() ^ (++this.batch * 0x9e3779b9)) >>> 0);
    const init = this.app.initPatchData();
    const favourites = this.favourites;
    const taken = this.app.liveNames();
    const out: Candidate[] = [];
    if (this.mode === 'library' && (!init || ctx.library.length === 0)) return this.app.flash('Generating needs an Init patch and some patches in the library.', 'error');
    if (this.mode === 'favourites' && favourites.length === 0) return this.app.flash('Heart some patches first: they are the parents.', 'error');
    if (this.mode === 'mutate' && !this.seed) return this.app.flash('Pick a patch to mutate (Mutate… on a patch).', 'error');
    for (let i = 0; i < this.count; i++) {
      let data: Uint8Array;
      let how: string;
      let parents: string[];
      if (this.mode === 'library') {
        data = fromLibrary(init!, ctx, random, this.wildness);
        how = `from the library, wildness ${Math.round(this.wildness * 100)}%`;
        parents = [];
      } else if (this.mode === 'favourites') {
        const a = pick(random, favourites);
        const b = favourites.length > 1 ? pick(random, favourites.filter((f) => f.id !== a.id)) : a;
        data = a === b ? mutate(a.data, ctx, random, Math.max(0.3, this.wildness)) : breed([a.data, b.data], ctx, random, this.wildness);
        how = a === b ? `mutation of "${a.name}"` : `bred from "${a.name}" × "${b.name}"`;
        parents = a === b ? [a.id] : [a.id, b.id];
      } else {
        data = mutate(this.seed!.data, ctx, random, this.wildness);
        how = `mutation of "${this.seed!.name}", amount ${Math.round(this.wildness * 100)}%`;
        parents = this.seed!.parents;
      }
      const name = suggestName(Math.floor(random() * 2 ** 32).toString(16).padStart(8, '0'), autoTags(data).category, taken);
      taken.add(name);
      const named = writeName(data, name);
      out.push({ key: `${this.batch}-${i}`, data: named, name, tags: autoTags(named).tags, how, parents });
    }
    this.candidates = out;
    this.playing = null;
  }

  audition(c: Candidate): void {
    this.playing = c.key;
    this.app.playAndShow(c.data, c.keptId ?? null);
  }

  async keep(c: Candidate, heart = false): Promise<void> {
    const { id } = await this.app.library.keep(c.data, c.parents, `generated: ${c.how}`, 'generated');
    if (heart) await this.app.library.setHearted(id, true);
    this.candidates = this.candidates.map((x) => (x.key === c.key ? { ...x, keptId: id } : x));
    this.app.flash(`Kept "${c.name}"${heart ? ' and hearted it' : ''}.`);
  }
}
