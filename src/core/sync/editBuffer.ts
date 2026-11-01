// Mirror of the synth's edit buffer (design.md §4.2). The synth is the source of truth: the mirror is
// updated optimistically by screen edits and by NRPNs from the panel, and replaced by full re-reads.
import { MAPPED_BY_ID, MAPPED_BY_NRPN, clampParam, diff, readParam, writeParam } from '../params/codec';
import { writeName } from '../patch/name';
import { PROGRAM_BYTES } from '../sysex/constants';

export type Outgoing =
  /** Send as an NRPN (smooth, no glitch). */
  | { kind: 'nrpn'; nrpn: number; value: number }
  /** No NRPN for this parameter: send the whole edit buffer. */
  | { kind: 'dump'; data: Uint8Array };

export class EditBufferMirror {
  data: Uint8Array;
  /** Library patch this sound started from, if known. */
  basedOn: string | null;
  /** NRPNs the synth sent that we have no mapping for (undocumented or unmapped parameters). */
  readonly unknownNrpns = new Map<number, number>();

  constructor(data: Uint8Array = new Uint8Array(PROGRAM_BYTES), basedOn: string | null = null) {
    this.data = Uint8Array.from(data);
    this.basedOn = basedOn;
  }

  get(id: string): number | undefined {
    const p = MAPPED_BY_ID.get(id);
    return p ? readParam(this.data, p) : undefined;
  }

  /** A change made on screen. Returns what to send to the synth, or null if nothing changed. */
  setFromScreen(id: string, value: number): Outgoing | null {
    const p = MAPPED_BY_ID.get(id);
    if (!p) return null;
    const v = clampParam(p, value);
    if (readParam(this.data, p) === v) return null;
    writeParam(this.data, p, v);
    return p.nrpn !== undefined ? { kind: 'nrpn', nrpn: p.nrpn, value: v } : { kind: 'dump', data: Uint8Array.from(this.data) };
  }

  /** Renames the sound. Names have no NRPN, so the whole edit buffer is sent. */
  setName(name: string): Outgoing | null {
    const next = writeName(this.data, name);
    if (next.every((b, i) => b === this.data[i])) return null;
    this.data = next;
    return { kind: 'dump', data: Uint8Array.from(next) };
  }

  /** An NRPN from the synth's panel. Returns the changed parameter id, or null. */
  applyNrpn(nrpn: number, value: number): string | null {
    const p = MAPPED_BY_NRPN.get(nrpn);
    if (!p) {
      this.unknownNrpns.set(nrpn, value);
      return null;
    }
    if (readParam(this.data, p) === clampParam(p, value)) return null;
    writeParam(this.data, p, value);
    return p.id;
  }

  /** A full edit-buffer read (or a patch we just sent). Returns the ids of parameters that changed. */
  replace(data: Uint8Array, basedOn?: string | null): string[] {
    const changed = diff(this.data, data);
    this.data = Uint8Array.from(data);
    if (basedOn !== undefined) this.basedOn = basedOn;
    return changed;
  }
}
