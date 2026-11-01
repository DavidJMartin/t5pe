// Round-trips every real program dump we have on disk: synth backups and any .syx fixtures.
// These files are gitignored, so on a fresh checkout this test has nothing to check and passes trivially.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROGRAM_DUMP_LENGTH } from '../src/core/sysex/constants';
import { parseTake5 } from '../src/core/sysex/messages';
import { packMsb } from '../src/core/sysex/pack';
import { splitSysex } from '../src/core/sysex/split';

function syxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.syx')).map((f) => join(dir, f));
}

const files = [...syxFiles('backups'), ...syxFiles('fixtures')];

describe.skipIf(files.length === 0)('real .syx files', () => {
  it.each(files)('%s: every program and edit-buffer dump unpacks and re-packs byte-for-byte', (file) => {
    const { messages, strayBytes, truncated } = splitSysex(new Uint8Array(readFileSync(file)));
    expect({ strayBytes, truncated }).toEqual({ strayBytes: 0, truncated: 0 });
    const dumps = messages.map(parseTake5).filter((m) => m?.kind === 'programDump' || m?.kind === 'editBufferDump');
    expect(dumps.length).toBeGreaterThan(0);
    for (const d of dumps) {
      expect(d.warnings).toEqual([]);
      const repacked = packMsb(Uint8Array.of(...d.data, 0, 0, 0, 0, 0, 0));
      expect(repacked).toEqual(new Uint8Array(d.packed));
      expect(d.packed.length + 7).toBe(PROGRAM_DUMP_LENGTH);
    }
  });
});
