// Parameter values ↔ program bytes. Everything that reads or changes a patch's sound (editor, sync,
// mutation, generation) goes through here, never through raw offsets.
import { BYTE_MAP } from './byteMap.generated';
import { HELD_BACK, PARAMS, type ParamDef } from './definitions';

export interface MappedParam extends ParamDef {
  /** [byte] or [lsb, msb]. */
  offsets: readonly number[];
}

/** Parameters whose bytes are known. `max` is corrected where the synth was seen to clamp. */
export const MAPPED: readonly MappedParam[] = PARAMS.flatMap((d) => {
  const loc = d.nrpn === undefined ? undefined : BYTE_MAP[d.nrpn];
  if (!loc || HELD_BACK[d.id]) return [];
  return [{ ...d, offsets: loc.offsets, min: loc.observedMin ?? d.min, max: loc.observedMax ?? d.max }];
});

export const MAPPED_BY_ID: ReadonlyMap<string, MappedParam> = new Map(MAPPED.map((p) => [p.id, p]));
export const MAPPED_BY_NRPN: ReadonlyMap<number, MappedParam> = new Map(MAPPED.map((p) => [p.nrpn!, p]));

export type ParamValues = Record<string, number>;

export function readParam(data: Uint8Array, p: MappedParam): number {
  const [lo, hi] = p.offsets;
  return hi === undefined ? data[lo] : data[lo] + 256 * data[hi];
}

export function clampParam(p: ParamDef, v: number): number {
  return Math.max(p.min, Math.min(p.max, Math.round(v)));
}

/** Writes `v` (clamped to the parameter's range) into `data` in place. */
export function writeParam(data: Uint8Array, p: MappedParam, v: number): void {
  const value = clampParam(p, v);
  const [lo, hi] = p.offsets;
  if (hi === undefined) {
    data[lo] = value;
  } else {
    data[lo] = value & 0xff;
    data[hi] = value >> 8;
  }
}

export function decode(data: Uint8Array): ParamValues {
  const values: ParamValues = {};
  for (const p of MAPPED) values[p.id] = readParam(data, p);
  return values;
}

/** A copy of `base` with `values` applied. Bytes no parameter owns (e.g. sequencer data) are kept. */
export function encode(base: Uint8Array, values: Partial<ParamValues>): Uint8Array {
  const out = Uint8Array.from(base);
  for (const [id, v] of Object.entries(values)) {
    const p = MAPPED_BY_ID.get(id);
    if (p && v !== undefined) writeParam(out, p, v);
  }
  return out;
}

/** Ids of the parameters whose values differ between two patches. */
export function diff(a: Uint8Array, b: Uint8Array): string[] {
  return MAPPED.filter((p) => readParam(a, p) !== readParam(b, p)).map((p) => p.id);
}
