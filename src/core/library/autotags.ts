// Rule-based tags from a patch's decoded parameters (design.md §3.8). No AI: thresholds were calibrated
// on the user's 511 real patches (2026-10-24): env 2 is the amp envelope; octave 2 is normal pitch
// (basses sit at 1, bells at 3); plucks get their pluck from the filter envelope (env 1).
import { decode, type ParamValues } from '../params/codec';

export interface AutoTags {
  /** Best single category, or null when nothing fits clearly. */
  category: string | null;
  /** Category plus character tags, e.g. ["pad", "bright", "evolving", "wide"]. */
  tags: string[];
}

// Mod matrix indices (MOD_SOURCES / MOD_DESTINATIONS in definitions.ts; destination names UNVERIFIED).
// Not used as tags: mod wheel / pressure / velocity routings (present in nearly every patch) and the
// "noise level" byte (63–64 in ~90% of patches, so its meaning is doubtful; protocol.md §3.3).
const SRC = { lfo1: 3, lfo2: 4, voiceSpread: 7, random: 17 };
const DEST_PANNING = 18;

export function autoTags(data: Uint8Array): AutoTags {
  return tagsFromValues(decode(data));
}

export function tagsFromValues(v: ParamValues): AutoTags {
  const audible = [
    { level: v['mixer.osc1'], octave: v['osc1.octave'] },
    { level: v['mixer.osc2'], octave: v['osc2.octave'] },
  ].filter((o) => o.level > 20);
  const octaves = audible.length ? audible.map((o) => o.octave) : [v['osc1.octave']];
  const lowest = Math.min(...octaves);

  const amp = { a: v['env2.attack'], d: v['env2.decay'], s: v['env2.sustain'], r: v['env2.release'] };
  const filterEnv = { a: v['env1.attack'], d: v['env1.decay'], s: v['env1.sustain'], amount: v['env1.amount'] - 127 };
  // Soft onset: a slow amp attack, or a filter that opens slowly (how most of the user's pads get soft).
  const soft = amp.a >= 30 || (filterEnv.a >= 60 && filterEnv.amount > 20);
  const hardOnset = amp.a < 10 && !soft;
  const decaying = hardOnset && amp.s < 40;
  const swell = soft;
  const filterPluck = amp.a < 10 && filterEnv.amount > 25 && filterEnv.s < 30 && filterEnv.d < 90;

  const slots = Array.from({ length: 16 }, (_, i) => ({
    source: v[`mod${i + 1}.source`],
    dest: v[`mod${i + 1}.dest`],
    amount: v[`mod${i + 1}.amount`] - 127,
  })).filter((m) => m.source !== 0 && m.dest !== 0 && Math.abs(m.amount) > 12);

  // Order matters: first match wins. User feedback 2026-10-25: pads are soft (Plink, a hard-attack sustained
  // sound, is keys, not pad); EPs that decay to silence are keys.
  let category: string | null = null;
  // The sub oscillator plays an octave below osc 1, and many basses get their low end from it.
  const lowestPitch = Math.min(lowest, v['mixer.sub'] >= 40 ? v['osc1.octave'] - 1 : Infinity);
  const lowFilter = v['filter.cutoff'] <= 400; // octave alone doesn't separate basses from pads/leads here
  if (lowestPitch <= 1 && !soft && amp.s >= 30 && amp.r <= 100 && (lowFilter || lowestPitch <= 0)) category = 'bass';
  else if (soft && amp.s >= 50) category = 'pad';
  else if (decaying && lowest >= 3) category = 'bell';
  else if (decaying) category = amp.d >= 70 ? 'keys' : 'percussive';
  else if (amp.a < 5 && amp.s >= 80 && amp.r <= 20) category = 'organ';
  else if (filterPluck) category = 'pluck';
  else if ((v['unison.on'] || v['glide.on']) && amp.s > 80) category = 'lead';
  else if (hardOnset && amp.s >= 60) category = 'keys';

  const tags = category ? [category] : [];
  const add = (tag: string, when: boolean) => when && !tags.includes(tag) && tags.push(tag);
  add('high', lowest >= 3);
  add('sub-heavy', v['mixer.sub'] >= 64);
  add('bright', v['filter.cutoff'] >= 650);
  add('dark', v['filter.cutoff'] <= 250 && filterEnv.amount <= 45);
  add('plucky', filterPluck && category !== 'pluck');
  add('sustained', !swell && amp.s >= 100);
  add('long tail', amp.r >= 100);
  add('evolving', slots.some((m) => [SRC.lfo1, SRC.lfo2, SRC.random].includes(m.source) && m.dest !== DEST_PANNING && Math.abs(m.amount) > 40));
  add('wide', slots.some((m) => m.source === SRC.voiceSpread && m.dest === DEST_PANNING));
  add('unison', v['unison.on'] === 1);
  add('detuned', audible.length === 2 && Math.abs(v['osc1.fine'] - v['osc2.fine']) >= 10);
  add('FM', v['osc.fm'] === 1);
  add('sync', v['osc.sync'] === 1);
  add('glide', v['glide.on'] === 1);
  add('drive', v['filter.drive'] >= 100 || v['filter.overdrive'] >= 60);
  add('effect', v['fx.on'] === 1 && v['fx.mix'] >= 30);
  add('reverb', v['reverb.on'] === 1 && v['reverb.mix'] >= 40);
  return { category, tags };
}
