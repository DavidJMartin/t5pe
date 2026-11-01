// Splits a .syx file into Take 5 patches (design.md §3.2).
import { readName } from '../patch/name';
import { parseTake5 } from '../sysex/messages';
import { splitSysex } from '../sysex/split';

export interface ParsedPatch {
  data: Uint8Array;
  name: string;
  /** Present for program dumps. */
  bank?: number;
  prog?: number;
}

export interface ParsedSyx {
  patches: ParsedPatch[];
  /** Messages that weren't Take 5 program or edit-buffer dumps. */
  ignored: number;
  warnings: string[];
}

export function parseSyx(bytes: Uint8Array): ParsedSyx {
  const { messages, strayBytes, truncated } = splitSysex(bytes);
  const warnings: string[] = [];
  if (strayBytes) warnings.push(`${strayBytes} bytes outside any SysEx message`);
  if (truncated) warnings.push(`${truncated} truncated message(s) skipped`);
  const patches: ParsedPatch[] = [];
  let ignored = 0;
  for (const msg of messages) {
    const m = parseTake5(msg);
    if (m?.kind === 'programDump') {
      patches.push({ data: m.data, name: readName(m.data), bank: m.bank, prog: m.prog });
    } else if (m?.kind === 'editBufferDump') {
      patches.push({ data: m.data, name: readName(m.data) });
    } else {
      ignored++;
      continue;
    }
    for (const w of m.warnings) warnings.push(`${readName(m.data)}: ${w}`);
  }
  return { patches, ignored, warnings };
}

/** Backups written by `npm run tool -- backup` are named take5-YYYY-MM-DD-HHMMSS[-INCOMPLETE].syx. */
export function backupDate(fileName: string): Date | null {
  const m = /^take5-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-INCOMPLETE)?\.syx$/.exec(fileName);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}
