// Human labels for synth slots. Banks 0–15 are shown on the panel as 1–9, A–G (protocol.md §7).
// UNVERIFIED: see protocol.md §7. Banks 16–31 appear to be factory banks; "F1–F16" is our own label.
import { USER_BANK_COUNT } from '../sysex/constants';

const USER_BANK_LABELS = '123456789ABCDEFG';

export function isFactoryBank(bank: number): boolean {
  return bank >= USER_BANK_COUNT;
}

export function bankLabel(bank: number): string {
  return isFactoryBank(bank) ? `F${bank - USER_BANK_COUNT + 1}` : (USER_BANK_LABELS[bank] ?? `?${bank}`);
}

export function slotLabel(bank: number, prog: number): string {
  return `${bankLabel(bank)}-${String(prog + 1).padStart(2, '0')}`;
}

export function slotKey(bank: number, prog: number): string {
  return `${bank}:${prog}`;
}
