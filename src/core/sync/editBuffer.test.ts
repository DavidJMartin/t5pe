import { describe, expect, it } from 'vitest';
import { MAPPED, readParam } from '../params/codec';
import { EditBufferMirror } from './editBuffer';

const p = MAPPED.find((m) => m.kind === 'continuous' && m.nrpn !== undefined);

describe.skipIf(!p)('EditBufferMirror', () => {
  it('turns a screen edit into an NRPN and ignores no-op edits', () => {
    const m = new EditBufferMirror();
    expect(m.setFromScreen(p!.id, 5)).toEqual({ kind: 'nrpn', nrpn: p!.nrpn, value: 5 });
    expect(m.setFromScreen(p!.id, 5)).toBeNull();
    expect(m.setFromScreen(p!.id, 99999)).toEqual({ kind: 'nrpn', nrpn: p!.nrpn, value: p!.max });
  });

  it('applies panel NRPNs and records unknown ones', () => {
    const m = new EditBufferMirror();
    expect(m.applyNrpn(p!.nrpn!, 7)).toBe(p!.id);
    expect(readParam(m.data, p!)).toBe(7);
    expect(m.applyNrpn(p!.nrpn!, 7)).toBeNull();
    expect(m.applyNrpn(3000, 1)).toBeNull();
    expect(m.unknownNrpns.get(3000)).toBe(1);
  });

  it('renames by sending the whole edit buffer', () => {
    const m = new EditBufferMirror();
    const out = m.setName('Brand New');
    expect(out?.kind).toBe('dump');
    expect(m.setName('Brand New')).toBeNull();
  });

  it('reports which parameters a re-read changed', () => {
    const m = new EditBufferMirror();
    const next = Uint8Array.from(m.data);
    next[p!.offsets[0]] = 3;
    expect(m.replace(next, 'abc')).toEqual([p!.id]);
    expect(m.basedOn).toBe('abc');
  });
});
