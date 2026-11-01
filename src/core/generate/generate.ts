// Patch generation (design.md §3.6–3.7). Works on parameter values via the codec, never raw bytes, and only
// touches parameters marked `mutable` (not volume, tempo, arp/keyboard setup); everything else, including
// unmapped bytes like sequencer data, comes from the starting patch.
//
// Deliberately not "safe" (user, 2026-10-25), but musical where it matters (user, same day: random fine
// tuning rarely sounds good). Every parameter is randomised by a rule that suits it: timbre controls roam
// freely; pitch is chosen in musical intervals with a few cents of detune; octaves move relative to each
// other; modulation into pitch stays at vibrato depth; choices draw on what real patches use.
import { decode, encode, MAPPED, type MappedParam, type ParamValues } from '../params/codec';
import { gaussian, pick, type Rng } from '../random';

const MUTABLE = MAPPED.filter((p) => p.mutable);

/** Parameters that belong together, swapped as a unit when crossing patches: sections, and each mod slot. */
const GROUPS: MappedParam[][] = (() => {
  const key = (p: MappedParam) => {
    if (p.section === 'mod') return p.id.split('.')[0]; // mod1 … mod16
    if (p.section === 'osc1' || p.section === 'osc2' || p.section === 'oscCommon') return 'osc'; // a tuning setup stays together
    return p.section;
  };
  const groups = new Map<string, MappedParam[]>();
  for (const p of MUTABLE) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
  return [...groups.values()];
})();

export interface GenerateContext {
  /** Decoded values of the library's patches: what "the library knows" about each parameter. */
  library: readonly ParamValues[];
}

// ---- Musical knowledge (indices into MOD_SOURCES / MOD_DESTINATIONS; destination names UNVERIFIED) ----

/** Fine tune: 700 = in tune, 1 unit = 1 cent, ±7 semitones (protocol.md §3.3). */
const IN_TUNE = 700;
/** Osc 2 relative to osc 1, in semitones, with weights: mostly unison/detune, sometimes classic intervals. */
const INTERVALS: [semitones: number, weight: number][] = [[0, 70], [7, 8], [5, 6], [-5, 4], [-7, 3], [4, 3], [3, 3], [-12, 0]];
const PITCH_DESTS = new Set([1, 2, 3, 4, 5]); // osc 1/2 octave, osc 1/2/all fine
const ENV_SOURCES = new Set([5, 6]); // env 1, env 2: pitch blips are musical
const AUDIO_RATE_SOURCES = new Set([1, 2, 16, 19]); // osc 2, noise, filter out, audio out: harsh on pitch
const MAX_FEEDBACK = 220; // of 255: above this, delays run away
const VIBRATO_DEPTH = 12; // ± around the 127 centre, for LFO/random → pitch
const BLIP_DEPTH = 50; // ± for envelope → pitch

const clamp = (p: MappedParam, v: number) => Math.max(p.min, Math.min(p.max, Math.round(v)));
const param = (id: string) => MAPPED.find((p) => p.id === id);
const fromLibrary_ = (ctx: GenerateContext, random: Rng, id: string) => pick(random, ctx.library)[id];

function weighted<T>(random: Rng, options: readonly [T, number][]): T {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = random() * total;
  for (const [v, w] of options) if ((r -= w) < 0) return v;
  return options[options.length - 1][0];
}

/** Osc 1 fine: in tune, or a few cents off. */
function osc1Fine(random: Rng): number {
  return random() < 0.7 ? IN_TUNE : IN_TUNE + Math.round(gaussian(random) * 4);
}

/** Osc 2 fine relative to osc 1: a musical interval (more varied as wildness rises) plus a little detune. */
function osc2Fine(osc1: number, random: Rng, wildness: number): number {
  const options = INTERVALS.filter(([st]) => Math.abs(st) <= 7).map(([st, w]): [number, number] => [st, st === 0 ? w * (1.3 - wildness) : w]);
  const semitones = weighted(random, options);
  const detune = semitones === 0 ? Math.round((3 + random() * 12) * (random() < 0.5 ? -1 : 1)) : Math.round(gaussian(random) * 3);
  return Math.max(0, Math.min(1400, osc1 + semitones * 100 + detune));
}

/** Osc 2 octave relative to osc 1: same, ±1, rarely ±2. */
function osc2Octave(osc1: number, random: Rng): number {
  const delta = weighted(random, [[0, 60], [-1, 18], [1, 15], [-2, 4], [2, 3]] as [number, number][]);
  return Math.max(0, Math.min(4, osc1 + delta));
}

/** A fresh value for one parameter, by the rule that suits it. */
function sample(p: MappedParam, values: ParamValues, ctx: GenerateContext, random: Rng, wildness: number): number {
  switch (p.id) {
    case 'osc1.fine':
      return osc1Fine(random);
    case 'osc2.fine':
      return osc2Fine(values['osc1.fine'], random, wildness);
    case 'osc2.octave':
      return osc2Octave(values['osc1.octave'], random);
    case 'fx.feedback':
      return Math.min(MAX_FEEDBACK, clamp(p, fromLibrary_(ctx, random, p.id)));
  }
  if (p.id.endsWith('.delay') || p.kind !== 'continuous') return clamp(p, fromLibrary_(ctx, random, p.id)); // what real patches use
  return random() < 0.7 ? clamp(p, fromLibrary_(ctx, random, p.id)) : clamp(p, p.min + random() * (p.max - p.min)); // timbre roams
}

/** A nudge to one parameter, by the rule that suits it. `amount` 0–1. */
function nudge(p: MappedParam, values: ParamValues, ctx: GenerateContext, random: Rng, amount: number): number {
  const v = values[p.id];
  switch (p.id) {
    case 'osc1.fine':
      return clamp(p, v + gaussian(random) * amount * 4);
    case 'osc2.fine':
      return random() < amount * 0.25 ? osc2Fine(values['osc1.fine'], random, amount) : clamp(p, v + gaussian(random) * amount * 6);
    case 'osc1.octave':
    case 'osc2.octave':
      return random() < amount * 0.3 ? clamp(p, v + (random() < 0.5 ? -1 : 1)) : v;
    case 'fx.feedback':
      return Math.min(Math.max(v, MAX_FEEDBACK), clamp(p, v + gaussian(random) * amount * 0.2 * p.max));
  }
  if (p.id.endsWith('.delay')) return clamp(p, v + gaussian(random) * amount * 8);
  if (p.kind === 'continuous') return clamp(p, v + gaussian(random) * amount * 0.2 * (p.max - p.min));
  return random() < amount * 0.5 ? clamp(p, fromLibrary_(ctx, random, p.id)) : v;
}

/** Keeps modulation into pitch musical on the slots that were changed. */
function tamePitchModulation(values: ParamValues, slots: Iterable<number>): void {
  for (const n of slots) {
    const source = values[`mod${n}.source`];
    const dest = values[`mod${n}.dest`];
    if (!source || !PITCH_DESTS.has(dest)) continue;
    if (AUDIO_RATE_SOURCES.has(source)) {
      values[`mod${n}.dest`] = 0; // noise/audio into pitch: drop the routing
      continue;
    }
    const depth = ENV_SOURCES.has(source) ? BLIP_DEPTH : VIBRATO_DEPTH;
    const offset = values[`mod${n}.amount`] - 127;
    values[`mod${n}.amount`] = 127 + Math.max(-depth, Math.min(depth, offset));
  }
}

/**
 * If osc 1's pitch changed but osc 2's didn't, osc 2 follows, keeping the interval between them; octaves never
 * end up more than 2 apart.
 */
function keepOscillatorsTogether(values: ParamValues, before: ParamValues, changed: ReadonlySet<string>, random: Rng): void {
  for (const [a, b] of [['osc1.fine', 'osc2.fine'], ['osc1.octave', 'osc2.octave']] as const) {
    if (changed.has(a) && !changed.has(b)) values[b] = clamp(param(b)!, values[a] + (before[b] - before[a]));
  }
  if (Math.abs(values['osc2.octave'] - values['osc1.octave']) > 2) values['osc2.octave'] = osc2Octave(values['osc1.octave'], random);
}

const slotOf = (id: string) => (id.startsWith('mod') ? Number(id.slice(3, id.indexOf('.'))) : null);

// ---- Generators ----

/** A random new patch made of sections from different library patches, roughened by `wildness` (0–1). */
export function fromLibrary(base: Uint8Array, ctx: GenerateContext, random: Rng, wildness: number): Uint8Array {
  const values = decode(base);
  for (const group of GROUPS) {
    const donor = pick(random, ctx.library);
    for (const p of group) values[p.id] = clamp(p, donor[p.id]);
  }
  const touched = new Set<number>();
  const before = { ...values };
  const changed = new Set<string>();
  for (const p of MUTABLE) {
    if (random() >= wildness * 0.4) continue;
    values[p.id] = sample(p, values, ctx, random, wildness);
    changed.add(p.id);
    const slot = slotOf(p.id);
    if (slot) touched.add(slot);
  }
  keepOscillatorsTogether(values, before, changed, random);
  const routings = Math.floor(random() * (1 + wildness * 3));
  for (let i = 0; i < routings; i++) {
    const slot = addRouting(values, random, wildness);
    if (slot) touched.add(slot);
  }
  tamePitchModulation(values, touched);
  return encode(base, guard(values));
}

/** Variations around a patch. `amount` 0–1: small nudges at the low end, reassigned choices and new routings at the top. */
export function mutate(seed: Uint8Array, ctx: GenerateContext, random: Rng, amount: number): Uint8Array {
  const values = decode(seed);
  const touched = new Set<number>();
  const before = { ...values };
  const changed = new Set<string>();
  for (const p of MUTABLE) {
    if (random() >= 0.1 + amount * 0.5) continue;
    const next = nudge(p, values, ctx, random, amount);
    if (next === values[p.id]) continue;
    values[p.id] = next;
    changed.add(p.id);
    const slot = slotOf(p.id);
    if (slot) touched.add(slot);
  }
  keepOscillatorsTogether(values, before, changed, random);
  if (random() < amount * 0.6) {
    const slot = addRouting(values, random, amount);
    if (slot) touched.add(slot);
  }
  tamePitchModulation(values, touched);
  return encode(seed, guard(values));
}

/** Children of several parents: each section from a random parent, then mutated by `wildness`. */
export function breed(parents: readonly Uint8Array[], ctx: GenerateContext, random: Rng, wildness: number): Uint8Array {
  const decoded = parents.map(decode);
  const values = { ...decoded[0] };
  for (const group of GROUPS) {
    const donor = pick(random, decoded);
    for (const p of group) values[p.id] = donor[p.id];
  }
  return mutate(encode(parents[0], values), ctx, random, wildness * 0.6);
}

/** Puts a new routing into an empty mod slot. Pitch destinations are rarer and get musical depths. Returns the slot. */
function addRouting(values: ParamValues, random: Rng, strength: number): number | null {
  const free = Array.from({ length: 16 }, (_, i) => i + 1).filter((n) => !values[`mod${n}.source`] || !values[`mod${n}.dest`]);
  const source = param('mod1.source');
  const dest = param('mod1.dest');
  if (!free.length || !source || !dest) return null;
  const n = pick(random, free);
  values[`mod${n}.source`] = 1 + Math.floor(random() * source.max);
  let d = 1 + Math.floor(random() * dest.max);
  if (PITCH_DESTS.has(d) && random() < 0.7) d = 6 + Math.floor(random() * (dest.max - 5)); // mostly timbre/space, not pitch
  values[`mod${n}.dest`] = d;
  const depth = 20 + random() * (40 + strength * 67);
  values[`mod${n}.amount`] = Math.round(127 + (random() < 0.5 ? -depth : depth));
  return n;
}

/** Makes sure a generated patch makes a sound; nothing more (no taste filter). */
export function guard(values: ParamValues): ParamValues {
  const v = values;
  if ((v['mixer.osc1'] ?? 0) < 10 && (v['mixer.osc2'] ?? 0) < 10 && (v['mixer.sub'] ?? 0) < 10) v['mixer.osc1'] = 100;
  if ((v['env2.sustain'] ?? 0) < 10 && (v['env2.decay'] ?? 0) < 12) v['env2.decay'] = 50;
  if ((v['env2.amount'] ?? 0) < 50) v['env2.amount'] = 100; // the VCA: too low is near-silent
  if ((v['filter.cutoff'] ?? 0) < 80 && (v['env1.amount'] ?? 127) - 127 < 30) v['filter.cutoff'] = 300;
  return v;
}
