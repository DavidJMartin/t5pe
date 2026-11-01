// A first guess at a patch's category from its name alone (design.md §3.7). Always shown as a guess;
// parameter-based inference replaces it once the byte map exists.

export const CATEGORIES = ['Bass', 'Lead', 'Pad', 'Strings', 'Keys', 'Organ', 'Brass', 'Bells', 'Pluck', 'Arp/Seq', 'Drums', 'FX'] as const;
export type Category = (typeof CATEGORIES)[number];

// First match wins, so the more specific rules come first.
const RULES: [Category, RegExp][] = [
  ['Drums', /\b(kicks?|kix|snares?|toms?|hats?|percs?|drums?|drooms|808|909|claps?)\b/i],
  ['Bass', /bass|\bsub\b|subfloor/i],
  ['Organ', /organ|hoover|\borg\b/i],
  ['Keys', /piano|pianet|\bep\b|e\.p\.|\bep-|rhodes|wurl|clav|keys|harpsi|\bkey\b/i],
  ['Bells', /bell|chime|marimba|vibra|kalimb|gamelan|mallet|dulcimer|koto|balaphone|celest|glock|metals?\b|dings/i],
  ['Strings', /string|orchestr|violin|cello/i],
  ['Brass', /brass|horn|trumpet|sax/i],
  ['Pluck', /pluck|plux|harp|pizz|plectrum|picky/i],
  ['Pad', /pad|swell|choir|vox|voc|atmos|ambien|texture|drone|evolve/i],
  ['Lead', /lead|solo|mono\b|sync/i],
  ['Arp/Seq', /\barp|arp\b|\bseq\b|sequence/i],
  ['FX', /sweep|fly ?by|alarm|ufo|scifi|sci-fi|noise|noize|landing|escaped|swarm|riser/i],
];

export function guessCategory(name: string): Category | null {
  for (const [category, re] of RULES) if (re.test(name)) return category;
  return null;
}
