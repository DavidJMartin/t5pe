import { describe, expect, it } from 'vitest';
import { encode } from '../params/codec';
import { PROGRAM_BYTES } from '../sysex/constants';
import { autoTags } from './autotags';

// A plain starting sound: one oscillator at normal pitch, open-ish filter, organ-style amp envelope.
const base = encode(new Uint8Array(PROGRAM_BYTES), {
  'osc1.octave': 2, 'osc2.octave': 2, 'mixer.osc1': 127, 'mixer.osc2': 0, 'filter.cutoff': 500,
  'env1.amount': 127, 'env2.attack': 0, 'env2.decay': 60, 'env2.sustain': 127, 'env2.release': 40,
});
const tags = (values: Record<string, number>) => autoTags(encode(base, values));

describe('autoTags', () => {
  it('slow attack → pad; zero-sustain → percussive or bell', () => {
    expect(tags({ 'env2.attack': 60 }).category).toBe('pad');
    expect(tags({ 'env2.sustain': 0 }).category).toBe('percussive');
    expect(tags({ 'env2.sustain': 0, 'osc1.octave': 3 }).category).toBe('bell');
  });

  it('a hard-attack sound that sustains is keys, not pad; one that opens its filter slowly is a pad', () => {
    expect(tags({ 'env2.sustain': 97, 'env2.release': 104 }).category).toBe('keys'); // like PLINK
    expect(tags({ 'env1.attack': 100, 'env1.amount': 200 }).category).toBe('pad'); // like Neon Pad
    expect(tags({ 'env2.sustain': 0, 'env2.decay': 110 }).category).toBe('keys'); // decaying EP
  });

  it('a sub-oscillator-heavy patch at normal pitch counts as bass', () => {
    expect(tags({ 'mixer.osc1': 15, 'mixer.sub': 119, 'filter.cutoff': 84 }).category).toBe('bass'); // like Techno Bass
  });

  it('low, filtered, short-release → bass; a bright one at normal pitch is not', () => {
    expect(tags({ 'osc1.octave': 1, 'filter.cutoff': 250 }).category).toBe('bass');
    expect(tags({ 'osc1.octave': 2, 'filter.cutoff': 800 }).category).not.toBe('bass');
  });

  it('adds character tags', () => {
    const t = tags({ 'filter.cutoff': 900, 'unison.on': 1, 'osc.sync': 1, 'mod1.source': 7, 'mod1.dest': 18, 'mod1.amount': 254 }).tags;
    expect(t).toEqual(expect.arrayContaining(['bright', 'unison', 'sync', 'wide']));
  });
});
