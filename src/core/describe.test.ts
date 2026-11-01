import { describe, expect, it } from 'vitest';
import { MidiDescriber } from './describe';
import { encodeNrpn } from './nrpn/decoder';
import { requestProgram } from './sysex/messages';
import { fakeProgramDump } from './sysex/testdata';

describe('MidiDescriber', () => {
  it('names NRPNs and hides the CCs that build them', () => {
    const d = new MidiDescriber();
    const out = encodeNrpn(0, 29, 512).map((m) => d.describe(m));
    expect(out.map((o) => o.complete)).toEqual([false, false, false, true]);
    expect(out[3].text).toBe('ch1 NRPN #29 FilterCutoff = 512');
  });

  it('flags global and undocumented NRPNs', () => {
    const d = new MidiDescriber();
    expect(encodeNrpn(0, 4106, 0).map((m) => d.describe(m))[3].text).toBe('ch1 NRPN #4106 SysexCable (GLOBAL) = 0');
    expect(encodeNrpn(0, 67, 3).map((m) => d.describe(m))[3].text).toBe('ch1 NRPN #67 (undocumented) = 3');
  });

  it('describes Take 5 SysEx and channel messages', () => {
    const d = new MidiDescriber();
    expect(d.describe(requestProgram(1, 2)).text).toBe('RequestProgram bank 1 prog 2');
    expect(d.describe(fakeProgramDump(1, 2, 'Pad')).text).toBe('ProgramDump bank 1 prog 2 "Pad" (4695 bytes)');
    expect(d.describe(Uint8Array.of(0x90, 60, 100)).text).toBe('ch1 NoteOn C4 vel 100');
    expect(d.describe(Uint8Array.of(0xb0, 32, 3)).text).toBe('ch1 CC32 (BankSelect LSB) = 3');
  });
});
