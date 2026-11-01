// Patch identity: SHA-256 of the canonical 4096 bytes (design.md §4.3).
import { NAME_LENGTH, NAME_OFFSET } from '../sysex/constants';

// WebCrypto exists in browsers and Node ≥ 19. Typed locally because src/core has no DOM lib.
interface Subtle {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}
const subtle = (globalThis as unknown as { crypto: { subtle: Subtle } }).crypto.subtle;

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A patch's id. */
export function patchId(data: Uint8Array): Promise<string> {
  return sha256Hex(data);
}

/** Hash with the name blanked, for "same sound, different name" hints. */
export function soundHash(data: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(data);
  copy.fill(0x20, NAME_OFFSET, NAME_OFFSET + NAME_LENGTH);
  return sha256Hex(copy);
}
