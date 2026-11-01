import { NAME_LENGTH, NAME_OFFSET } from '../sysex/constants';

/** Program name: 20 ASCII bytes at offset 195, space-padded (protocol.md §3.2). Non-printables show as '?'. */
export function readName(data: Uint8Array): string {
  let s = '';
  for (const b of data.subarray(NAME_OFFSET, NAME_OFFSET + NAME_LENGTH)) {
    s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : b === 0 ? ' ' : '?';
  }
  return s.trimEnd();
}

/** Characters the synth can show: printable ASCII. Anything else becomes '?'. */
export function sanitizeName(name: string): string {
  return Array.from(name, (c) => (c >= ' ' && c <= '~' ? c : '?')).join('').slice(0, NAME_LENGTH).trimEnd();
}

/** Returns a copy of `data` with the name replaced (sanitised, space-padded to 20). */
export function writeName(data: Uint8Array, name: string): Uint8Array {
  const out = Uint8Array.from(data);
  const clean = sanitizeName(name).padEnd(NAME_LENGTH, ' ');
  for (let i = 0; i < NAME_LENGTH; i++) out[NAME_OFFSET + i] = clean.charCodeAt(i);
  return out;
}
