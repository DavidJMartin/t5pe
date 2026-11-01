// NRPN numbers from the Take 5 MIDI Implementation 1.2 (protocol.md §5.2, §5.3). All DOC, none verified.
// Used for display only (monitor). The parameter model proper is built in Phase 0 `map`.

export interface NrpnInfo {
  name: string;
  max: number;
  global?: boolean;
}

const program: Record<number, NrpnInfo> = {
  0: { name: 'BPM', max: 249 },
  1: { name: 'ProgramVolume', max: 127 },
  2: { name: 'Osc1GlideRate', max: 127 },
  3: { name: 'Osc2GlideRate', max: 127 },
  4: { name: 'GlideOn', max: 1 },
  5: { name: 'GlideMode', max: 4 },
  6: { name: 'OscSync', max: 1 },
  7: { name: 'Osc1KeyTrack', max: 1 },
  8: { name: 'Osc1Octave', max: 4 },
  9: { name: 'Osc1Fine', max: 1400 },
  10: { name: 'Osc1Shape', max: 127 },
  11: { name: 'FmOn', max: 1 },
  12: { name: 'Osc2KeyTrack', max: 1 },
  13: { name: 'Osc2Octave', max: 4 },
  14: { name: 'Osc2Fine', max: 1400 },
  15: { name: 'Osc2Shape', max: 127 },
  16: { name: 'FxOn', max: 1 },
  17: { name: 'FxSelect', max: 8 }, // UNVERIFIED: OS 2.0 Lo-Fi may make this 9 (protocol.md §5.2)
  18: { name: 'FxMix', max: 127 },
  19: { name: 'FxTime', max: 127 },
  20: { name: 'FxFeedback', max: 127 },
  21: { name: 'FxSync', max: 1 },
  22: { name: 'FxSyncRate', max: 10 },
  23: { name: 'ReverbOn', max: 1 },
  24: { name: 'ReverbMix', max: 127 },
  25: { name: 'ReverbSize', max: 127 },
  26: { name: 'ReverbPredelay', max: 127 },
  27: { name: 'ReverbDecay', max: 127 },
  28: { name: 'ReverbTone', max: 127 },
  29: { name: 'FilterCutoff', max: 1023 },
  30: { name: 'FilterCutoffMsb', max: 127 },
  31: { name: 'FilterResonance', max: 127 },
  32: { name: 'FilterDrive', max: 127 },
  33: { name: 'FilterKeyAmount', max: 127 },
  34: { name: 'Vintage', max: 127 },
  35: { name: 'Overdrive', max: 127 },
  36: { name: 'Osc1Level', max: 127 },
  37: { name: 'Osc2Level', max: 127 },
  38: { name: 'SubLevel', max: 127 },
  39: { name: 'NoiseLevel', max: 127 },
  40: { name: 'Env1AuxDest', max: 54 },
  41: { name: 'Env1Delay', max: 127 },
  42: { name: 'Env1Attack', max: 127 },
  43: { name: 'Env1Decay', max: 127 },
  44: { name: 'Env1Sustain', max: 127 },
  45: { name: 'Env1Release', max: 127 },
  46: { name: 'Env1Amount', max: 255 },
  47: { name: 'Env1Velocity', max: 1 },
  48: { name: 'Env2Delay', max: 127 },
  49: { name: 'Env2Attack', max: 127 },
  50: { name: 'Env2Decay', max: 127 },
  51: { name: 'Env2Sustain', max: 127 },
  52: { name: 'Env2Release', max: 127 },
  53: { name: 'Env2Amount', max: 255 },
  54: { name: 'Env2Velocity', max: 1 },
  55: { name: 'EnvRouting', max: 2 },
  56: { name: 'UnisonOn', max: 1 },
  57: { name: 'UnisonVoices', max: 5 },
  58: { name: 'UnisonDetune', max: 7 },
  59: { name: 'UnisonKeyMode', max: 2 },
  60: { name: 'UnisonRetrigger', max: 1 },
  61: { name: 'Lfo1Freq', max: 127 },
  62: { name: 'Lfo1Amount', max: 255 },
  63: { name: 'Lfo1Shape', max: 4 },
  64: { name: 'Lfo1Sync', max: 1 },
  65: { name: 'Lfo1SyncFreq', max: 15 },
  66: { name: 'Lfo1NoteReset', max: 1 },
  68: { name: 'Lfo2Freq', max: 127 },
  69: { name: 'Lfo2Amount', max: 255 },
  70: { name: 'Lfo2Shape', max: 4 },
  71: { name: 'Lfo2Sync', max: 1 },
  72: { name: 'Lfo2SyncFreq', max: 15 },
  73: { name: 'Lfo2NoteReset', max: 1 },
  75: { name: 'BendUp', max: 12 },
  76: { name: 'BendDown', max: 24 },
  163: { name: 'ArpOn', max: 1 },
  164: { name: 'ArpMode', max: 2 },
  165: { name: 'ArpRange', max: 2 },
  166: { name: 'ArpRepeats', max: 3 },
  167: { name: 'ClockDivision', max: 7 },
  168: { name: 'ArpRelatch', max: 1 },
  169: { name: 'OctDown1', max: 1 },
  170: { name: 'KeySplitNote', max: 44 },
  171: { name: 'OctDown2', max: 1 },
  4198: { name: 'SequencerOn', max: 1 },
  4199: { name: 'SequencerRecordArm', max: 1 },
};
for (let slot = 1; slot <= 16; slot++) {
  program[76 + slot] = { name: `Mod${slot}Source`, max: 19 };
  program[92 + slot] = { name: `Mod${slot}Amount`, max: 255 };
  program[108 + slot] = { name: `Mod${slot}Dest`, max: 54 };
}

const globalNames = [
  'CoarseTune', 'FineTune', 'MidiChannel', 'ClockMode', 'ClockCableIn', 'ClockCableOut', 'ParamSend',
  'ParamReceive', 'MidiControl', 'SysexOn', 'SysexCable', 'MidiOutSelect', 'ProgramSend', 'ProgramReceive',
  'ArpNotesOut', 'LocalControl', 'MonoStereo', 'PotMode', 'PedalFunction', 'PedalPolarity', 'FootFunction',
  'Scale', 'AftertouchOn', 'AftertouchCurve', 'VelocityCurve', 'ScreenSaver', 'ArpBeatSync',
];

export const GLOBAL_NRPN_FIRST = 4096;
export const GLOBAL_NRPN_LAST = GLOBAL_NRPN_FIRST + globalNames.length - 1; // 4122

export function nrpnInfo(param: number): NrpnInfo | undefined {
  if (param >= GLOBAL_NRPN_FIRST && param <= GLOBAL_NRPN_LAST) {
    return { name: globalNames[param - GLOBAL_NRPN_FIRST], max: 16383, global: true };
  }
  return program[param];
}

/** Program-parameter NRPNs: volatile (edit buffer) per the CLAUDE.md safety rules. */
export function isProgramNrpn(param: number): boolean {
  return param < GLOBAL_NRPN_FIRST || param === 4198 || param === 4199;
}

export function isGlobalNrpn(param: number): boolean {
  return param >= GLOBAL_NRPN_FIRST && param <= GLOBAL_NRPN_LAST;
}
