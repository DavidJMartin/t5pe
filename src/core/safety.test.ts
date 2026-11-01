import { describe, expect, it } from 'vitest';
import { encodeNrpn } from './nrpn/decoder';
import { OutboundClassifier } from './safety';
import { deviceInquiry, requestEditBuffer, requestGlobals, requestProgram } from './sysex/messages';
import { fakeProgramDump } from './sysex/testdata';

const levels = (c: OutboundClassifier, msgs: Uint8Array[]) => msgs.map((m) => c.classify(m).level);

describe('OutboundClassifier', () => {
  it('treats inquiry and dump requests as reads', () => {
    const c = new OutboundClassifier();
    expect(levels(c, [deviceInquiry(), requestProgram(0, 0), requestEditBuffer(), requestGlobals()])).toEqual(['read', 'read', 'read', 'read']);
  });

  it('treats program dumps as persistent and edit buffer dumps as volatile', () => {
    const c = new OutboundClassifier();
    const prog = fakeProgramDump(0, 0, 'x');
    const edit = Uint8Array.of(0xf0, 0x01, 0x35, 0x03, ...prog.subarray(6));
    expect(c.classify(prog).level).toBe('persistent');
    expect(c.classify(edit).level).toBe('volatile');
  });

  it('forbids unrecognised SysEx', () => {
    expect(new OutboundClassifier().classify(Uint8Array.of(0xf0, 0x01, 0x35, 0x7f, 0xf7)).level).toBe('forbidden');
    expect(new OutboundClassifier().classify(Uint8Array.of(0xf0, 0x7d, 0xf7)).level).toBe('forbidden');
  });

  it('classifies NRPN data entry by the selected parameter', () => {
    const c = new OutboundClassifier();
    expect(levels(c, encodeNrpn(0, 29, 512))).toEqual(['volatile', 'volatile', 'volatile', 'volatile']);
    expect(levels(c, encodeNrpn(0, 4106, 0)).slice(2)).toEqual(['persistent', 'persistent']); // Sysex Cable
    expect(levels(c, encodeNrpn(0, 4198, 1)).slice(2)).toEqual(['volatile', 'volatile']); // sequencer on/off
    expect(new OutboundClassifier().classify(Uint8Array.of(0xb0, 6, 0)).level).toBe('persistent');
  });

  it('treats program change and notes as volatile, other channel messages as persistent', () => {
    const c = new OutboundClassifier();
    expect(c.classify(Uint8Array.of(0xc0, 5)).level).toBe('volatile');
    expect(c.classify(Uint8Array.of(0xb0, 74, 64)).level).toBe('persistent');
    expect(c.classify(Uint8Array.of(0x90, 60, 100)).level).toBe('volatile'); // notes (approved 2026-10-25)
    expect(c.classify(Uint8Array.of(0x80, 60, 0)).level).toBe('volatile');
    expect(c.classify(Uint8Array.of(0xb0, 123, 0)).level).toBe('volatile'); // all notes off
    expect(c.classify(Uint8Array.of(0xe0, 0, 64)).level).toBe('persistent'); // still not covered: pitch bend
  });
});
