// The Take 5 parameter model (design.md §3.4, §3.6–3.7). One definition per program parameter:
// how to show it, how to send it (NRPN), and how generation/mutation may treat it. Where each one
// lives in the 4096 program bytes comes from the hardware mapping (byteMap.generated.ts).
//
// NRPN numbers and ranges: Take 5 MIDI Implementation 1.2 (protocol.md §5.2), corrected by mapping.
// Value names: Take 5 User's Guide 1.1. Names marked UNVERIFIED have not been checked on the synth.

export type ParamKind =
  /** A knob: any value in [min, max]. */
  | 'continuous'
  /** On/off. */
  | 'switch'
  /** One of `options`. */
  | 'choice';

export type SectionId =
  | 'osc1'
  | 'osc2'
  | 'oscCommon'
  | 'mixer'
  | 'filter'
  | 'env1'
  | 'env2'
  | 'lfo1'
  | 'lfo2'
  | 'fx'
  | 'reverb'
  | 'voice'
  | 'arp'
  | 'mod';

export interface ParamDef {
  /** Stable key, e.g. "filter.cutoff". Used in saved values, locks and generated patches. */
  id: string;
  label: string;
  section: SectionId;
  kind: ParamKind;
  min: number;
  max: number;
  /** Program-parameter NRPN, if the synth has one. */
  nrpn?: number;
  options?: readonly string[];
  /** Value shown as zero (e.g. fine tune at 700 = no detune). */
  center?: number;
  /** Turns a raw value into display text. */
  format?: (v: number) => string;
  /** False for things generation/mutation must leave alone by default (volume, tempo, keyboard setup). */
  mutable: boolean;
}

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'osc1', label: 'Oscillator 1' },
  { id: 'osc2', label: 'Oscillator 2' },
  { id: 'oscCommon', label: 'Sync, FM & glide' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'filter', label: 'Filter' },
  { id: 'env1', label: 'Envelope 1 (filter)' },
  { id: 'env2', label: 'Envelope 2 (amp)' },
  { id: 'lfo1', label: 'LFO 1 (global)' },
  { id: 'lfo2', label: 'LFO 2 (per voice)' },
  { id: 'fx', label: 'Effect' },
  { id: 'reverb', label: 'Reverb' },
  { id: 'voice', label: 'Voice, unison & program' },
  { id: 'arp', label: 'Arpeggiator & keyboard' },
  { id: 'mod', label: 'Mod matrix' },
];

export const MOD_SOURCES = [
  'Off', 'Osc 2', 'Noise', 'LFO 1', 'LFO 2', 'Env 1', 'Env 2', 'Voice Spread', 'Pitch Bend', 'Mod Wheel',
  'Pressure', 'Breath', 'Foot Pedal', 'Expression', 'Velocity', 'Note Number', 'Filter Out', 'Random', 'DC', 'Audio Out',
] as const;

// UNVERIFIED: see protocol.md §5.2. The guide lists 57 names for a range of 0–54; order from its two-column layout.
export const MOD_DESTINATIONS = [
  'Off', 'Osc 1 Octave', 'Osc 2 Octave', 'Osc 1 Fine', 'Osc 2 Fine', 'Osc All Fine', 'Osc 1 Shape', 'Osc 2 Shape',
  'Osc All Shape', 'Osc 1 Level', 'Osc 2 Level', 'Osc FM Level', 'Sub Level', 'Noise', 'Drive', 'Cutoff', 'Resonance',
  'Overdrive', 'Panning', 'FX Mix', 'FX Time', 'FX Misc', 'Reverb Mix', 'Reverb Size', 'Reverb PreDelay', 'Reverb Decay',
  'Reverb Tone', 'LFO 1 Freq', 'LFO 2 Freq', 'LFO All Freq', 'LFO 1 Amt', 'LFO 2 Amt', 'LFO All Amt', 'Env 1 Amt',
  'Env 2 Amt', 'Env 1 Attack', 'Env 2 Attack', 'Env 1 Decay', 'Env 2 Decay', 'Env 1 Release', 'Env 2 Release',
  'Mod 1 Amt', 'Mod 2 Amt', 'Mod 3 Amt', 'Mod 4 Amt', 'Mod 5 Amt', 'Mod 6 Amt', 'Mod 7 Amt', 'Mod 8 Amt', 'Mod 9 Amt',
  'Mod 10 Amt', 'Mod 11 Amt', 'Mod 12 Amt', 'Mod 13 Amt', 'Mod 14 Amt', 'Mod 15 Amt', 'Mod 16 Amt',
] as const;

// UNVERIFIED: the synth stores 0–12 (13 values, mapped 2026-10-24); the guide names 11 types and OS 2.0 adds Lo-Fi.
// Order from the guide; the 13th is unknown. To be checked by stepping through types on the panel.
export const FX_TYPES = [
  'Delay', 'BBD', 'Tape Delay 1', 'Tape Delay 2', 'Chorus', 'Flanger', 'Phaser', 'HP Filter', 'Distortion', 'Ring Mod',
  'Rotating Speaker', 'Lo-Fi', 'Type 13 (unknown)',
] as const;

const LFO_SHAPES = ['Triangle', 'Sawtooth', 'Reverse Saw', 'Square', 'Sample & Hold'] as const; // UNVERIFIED order
const GLIDE_MODES = ['Fixed Rate', 'Fixed Rate A', 'Fixed Time', 'Fixed Time A', 'Mode 5'] as const; // UNVERIFIED; doc range 0–4
const ENV2_ROUTING = ['Amp', 'Filter + Amp', 'Filter + Gate'] as const; // UNVERIFIED order
const UNISON_KEY_MODES = ['Low', 'High', 'Last'] as const;
const ARP_MODES = ['Up', 'Down', 'Up + Down', 'Random', 'Assign'] as const; // UNVERIFIED: doc range 0–2, guide lists 5
const OCTAVES = ['-2', '-1', '0', '+1', '+2'] as const; // UNVERIFIED: 5-octave range, shown relative to the middle

const semitones = (v: number) => {
  const st = (v - 700) / 100;
  return `${st > 0 ? '+' : ''}${st.toFixed(2)} st`;
};
const bipolar127 = (v: number) => `${v - 127 > 0 ? '+' : ''}${v - 127}`;

type Spec = Omit<ParamDef, 'kind' | 'mutable' | 'min'> & Partial<Pick<ParamDef, 'kind' | 'mutable' | 'min'>>;

function p(spec: Spec): ParamDef {
  const kind = spec.kind ?? (spec.options ? 'choice' : spec.max === 1 ? 'switch' : 'continuous');
  return { min: 0, mutable: true, ...spec, kind };
}

const onOff = (id: string, label: string, section: SectionId, nrpn: number, mutable = true) =>
  p({ id, label, section, nrpn, max: 1, mutable });

const knob = (id: string, label: string, section: SectionId, nrpn: number, max = 127, extra: Partial<ParamDef> = {}) =>
  p({ id, label, section, nrpn, max, ...extra });

const oscillator = (n: 1 | 2, base: { octave: number; fine: number; shape: number; keyTrack: number }): ParamDef[] => [
  p({ id: `osc${n}.octave`, label: 'Octave', section: `osc${n}`, nrpn: base.octave, max: 4, options: OCTAVES }),
  knob(`osc${n}.fine`, 'Fine', `osc${n}`, base.fine, 1400, { center: 700, format: semitones }),
  knob(`osc${n}.shape`, 'Shape', `osc${n}`, base.shape),
  onOff(`osc${n}.keyTrack`, 'Key track', `osc${n}`, base.keyTrack),
];

const envelope = (n: 1 | 2, base: number, amount: number, velocity: number): ParamDef[] => [
  knob(`env${n}.delay`, 'Delay', `env${n}`, base),
  knob(`env${n}.attack`, 'Attack', `env${n}`, base + 1),
  knob(`env${n}.decay`, 'Decay', `env${n}`, base + 2),
  knob(`env${n}.sustain`, 'Sustain', `env${n}`, base + 3),
  knob(`env${n}.release`, 'Release', `env${n}`, base + 4),
  // Env 1 amount stores 0–254 (bipolar around 127, UNVERIFIED); env 2 amount 0–127 (mapped 2026-10-24).
  n === 1 ? knob('env1.amount', 'Amount', 'env1', amount, 254, { center: 127, format: bipolar127 }) : knob('env2.amount', 'Amount', 'env2', amount, 127),
  onOff(`env${n}.velocity`, 'Velocity', `env${n}`, velocity),
];

const lfo = (n: 1 | 2, base: number): ParamDef[] => [
  knob(`lfo${n}.freq`, 'Rate', `lfo${n}`, base),
  knob(`lfo${n}.amount`, 'Amount', `lfo${n}`, base + 1, 255),
  p({ id: `lfo${n}.shape`, label: 'Shape', section: `lfo${n}`, nrpn: base + 2, max: 4, options: LFO_SHAPES }),
  onOff(`lfo${n}.sync`, 'Clock sync', `lfo${n}`, base + 3),
  knob(`lfo${n}.syncFreq`, 'Sync rate', `lfo${n}`, base + 4, 15),
  onOff(`lfo${n}.noteReset`, 'Key reset', `lfo${n}`, base + 5),
];

const modSlots = (): ParamDef[] =>
  Array.from({ length: 16 }, (_, i) => [
    p({ id: `mod${i + 1}.source`, label: `${i + 1} source`, section: 'mod', nrpn: 77 + i, max: 19, options: MOD_SOURCES }),
    knob(`mod${i + 1}.amount`, `${i + 1} amount`, 'mod', 93 + i, 254, { center: 127, format: bipolar127 }),
    p({ id: `mod${i + 1}.dest`, label: `${i + 1} destination`, section: 'mod', nrpn: 109 + i, max: 54, options: MOD_DESTINATIONS }),
  ]).flat();

export const PARAMS: readonly ParamDef[] = [
  ...oscillator(1, { octave: 8, fine: 9, shape: 10, keyTrack: 7 }),
  ...oscillator(2, { octave: 13, fine: 14, shape: 15, keyTrack: 12 }),
  onOff('osc.sync', 'Osc 1–2 sync', 'oscCommon', 6),
  onOff('osc.fm', 'FM', 'oscCommon', 11),
  onOff('glide.on', 'Glide', 'oscCommon', 4),
  p({ id: 'glide.mode', label: 'Glide mode', section: 'oscCommon', nrpn: 5, max: 4, options: GLIDE_MODES }),
  knob('glide.osc1Rate', 'Osc 1 glide', 'oscCommon', 2),
  knob('glide.osc2Rate', 'Osc 2 glide', 'oscCommon', 3),

  knob('mixer.osc1', 'Osc 1', 'mixer', 36),
  knob('mixer.osc2', 'Osc 2', 'mixer', 37),
  knob('mixer.sub', 'Sub', 'mixer', 38),
  knob('mixer.noise', 'Noise', 'mixer', 39),

  knob('filter.cutoff', 'Cutoff', 'filter', 29, 1023),
  knob('filter.resonance', 'Resonance', 'filter', 31),
  knob('filter.drive', 'Drive', 'filter', 32),
  knob('filter.keyAmount', 'Key amount', 'filter', 33),
  knob('filter.overdrive', 'Overdrive', 'filter', 35),
  knob('voice.vintage', 'Vintage', 'filter', 34),

  ...envelope(1, 41, 46, 47),
  p({ id: 'env1.auxDest', label: 'Aux destination', section: 'env1', nrpn: 40, max: 54, options: MOD_DESTINATIONS }),
  ...envelope(2, 48, 53, 54),
  p({ id: 'env.routing', label: 'Env 2 routing', section: 'env2', nrpn: 55, max: 2, options: ENV2_ROUTING }),

  ...lfo(1, 61),
  ...lfo(2, 68),

  onOff('fx.on', 'On', 'fx', 16),
  p({ id: 'fx.type', label: 'Type', section: 'fx', nrpn: 17, max: 8, options: FX_TYPES }),
  knob('fx.mix', 'Mix', 'fx', 18),
  knob('fx.time', 'Time', 'fx', 19),
  knob('fx.feedback', 'Feedback / misc', 'fx', 20),
  onOff('fx.sync', 'Clock sync', 'fx', 21),
  knob('fx.syncRate', 'Sync rate', 'fx', 22, 10),

  onOff('reverb.on', 'On', 'reverb', 23),
  knob('reverb.mix', 'Mix', 'reverb', 24),
  knob('reverb.size', 'Size', 'reverb', 25),
  knob('reverb.predelay', 'Pre-delay', 'reverb', 26),
  knob('reverb.decay', 'Decay', 'reverb', 27),
  knob('reverb.tone', 'Tone', 'reverb', 28),

  onOff('unison.on', 'Unison', 'voice', 56),
  knob('unison.voices', 'Unison voices', 'voice', 57, 5, { format: (v) => String(v + 1) }), // UNVERIFIED: 0 = 1 voice?
  knob('unison.detune', 'Unison detune', 'voice', 58, 7),
  p({ id: 'unison.keyMode', label: 'Unison key mode', section: 'voice', nrpn: 59, max: 2, options: UNISON_KEY_MODES }),
  onOff('unison.retrigger', 'Unison env retrigger', 'voice', 60),
  knob('program.volume', 'Program volume', 'voice', 1, 127, { mutable: false }),
  knob('program.bendUp', 'Bend up', 'voice', 75, 12, { mutable: false }),
  knob('program.bendDown', 'Bend down', 'voice', 76, 24, { mutable: false }),
  knob('program.bpm', 'BPM', 'voice', 0, 249, { min: 30, mutable: false }),

  onOff('arp.on', 'Arpeggiator', 'arp', 163, false),
  p({ id: 'arp.mode', label: 'Arp mode', section: 'arp', nrpn: 164, max: 2, options: ARP_MODES, mutable: false }),
  knob('arp.range', 'Arp octaves', 'arp', 165, 2, { format: (v) => String(v + 1), mutable: false }),
  knob('arp.repeats', 'Arp repeats', 'arp', 166, 3, { mutable: false }),
  knob('arp.clockDivision', 'Clock division', 'arp', 167, 7, { mutable: false }),
  onOff('arp.relatch', 'Arp relatch', 'arp', 168, false),
  onOff('keys.octDown1', 'Lower −1 oct', 'arp', 169, false),
  knob('keys.splitNote', 'Split note', 'arp', 170, 44, { mutable: false }),
  onOff('keys.octDown2', 'Lower −2 oct', 'arp', 171, false),

  ...modSlots(),
];

/**
 * Parameters whose mapped byte contradicts real patches, so it isn't trusted yet (protocol.md §3.2).
 * The editor leaves them out until the guided session at the synth explains them.
 */
export const HELD_BACK: Readonly<Record<string, string>> = {
  'arp.on': 'NRPN 163 toggles byte 219, but real patches hold 0–4 there, so it is not a plain on/off',
  'keys.octDown1': 'NRPN 169 toggles byte 229, but every real patch holds 19 there',
};

export const PARAMS_BY_ID: ReadonlyMap<string, ParamDef> = new Map(PARAMS.map((d) => [d.id, d]));
export const PARAMS_BY_NRPN: ReadonlyMap<number, ParamDef> = new Map(PARAMS.filter((d) => d.nrpn !== undefined).map((d) => [d.nrpn!, d]));

export function formatValue(def: ParamDef, v: number): string {
  if (def.options) return def.options[v] ?? `#${v}`;
  if (def.kind === 'switch') return v ? 'On' : 'Off';
  if (def.format) return def.format(v);
  return String(v);
}
