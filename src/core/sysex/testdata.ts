// Synthetic messages for unit tests.
import { NAME_OFFSET, PROGRAM_BYTES } from './constants';
import { packMsb } from './pack';

export function fakeProgramDump(bank: number, prog: number, name: string): Uint8Array {
  const data = new Uint8Array(PROGRAM_BYTES + 6);
  for (let i = 0; i < 954; i++) data[i] = (i * 7 + bank + prog) & 0xff;
  for (let i = 0; i < 20; i++) data[NAME_OFFSET + i] = i < name.length ? name.charCodeAt(i) : 0x20;
  return Uint8Array.of(0xf0, 0x01, 0x35, 0x02, bank, prog, ...packMsb(data), 0xf7);
}
