import { parseTake5, requestEditBuffer, requestProgram } from '../core/sysex/messages';
import { request } from './request';
import type { MidiTransport } from './transport';

export type ProgramDump = Extract<NonNullable<ReturnType<typeof parseTake5>>, { kind: 'programDump' }>;
export type EditBufferDump = Extract<NonNullable<ReturnType<typeof parseTake5>>, { kind: 'editBufferDump' }>;

/**
 * Requests one program and resolves with the dump labelled with that bank/prog. Replies can arrive
 * well after a timeout (probe 2026-10-24: up to ~1.5 s), so dumps for other slots are passed to
 * `onStray` instead of being taken as the answer.
 */
export function fetchProgram(t: MidiTransport, bank: number, prog: number, timeoutMs: number, onStray?: (p: ProgramDump) => void) {
  return request(t, requestProgram(bank, prog), (m) => {
    const p = parseTake5(m);
    if (p?.kind !== 'programDump') return null;
    if (p.bank === bank && p.prog === prog) return p;
    onStray?.(p);
    return null;
  }, timeoutMs);
}

export function fetchEditBuffer(t: MidiTransport, timeoutMs: number) {
  return request(t, requestEditBuffer(), (m) => {
    const p = parseTake5(m);
    return p?.kind === 'editBufferDump' ? p : null;
  }, timeoutMs);
}
