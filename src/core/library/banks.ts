// Bank planning (design.md §3.5): what is on the synth now, and what a plan would change.
import { PROGRAMS_PER_BANK, USER_BANK_COUNT } from '../sysex/constants';
import { slotKey } from './slots';
import type { Snapshot } from './types';

/** A planned slot: a library patch id, or 'init' for the Init patch. */
export type PlannedSlot = string;
export const INIT = 'init';

/** Planned changes only, keyed "bank:prog". Slots not in the plan stay as they are on the synth. */
export type BankPlan = Record<string, PlannedSlot>;

/**
 * What the synth holds, slot by slot: for each slot, the patch from the most recent snapshot (synth read,
 * backup, pre/post-push read) that covered it. Snapshots can cover a few slots or all of them.
 */
export function currentSynthSlots(snapshots: readonly Snapshot[]): Map<string, string> {
  const slots = new Map<string, string>();
  for (const s of [...snapshots].sort((a, b) => a.takenAt - b.takenAt)) {
    for (const [key, id] of Object.entries(s.slots)) slots.set(key, id);
  }
  return slots;
}

export interface SlotChange {
  bank: number;
  prog: number;
  key: string;
  /** What the synth holds now (if known). */
  from: string | undefined;
  /** Patch id to write. */
  to: string;
}

/** The writes a plan needs: user-bank slots whose planned patch differs from what the synth holds. */
export function planChanges(plan: BankPlan, synth: ReadonlyMap<string, string>, initId: string | null): SlotChange[] {
  const changes: SlotChange[] = [];
  for (let bank = 0; bank < USER_BANK_COUNT; bank++) {
    for (let prog = 0; prog < PROGRAMS_PER_BANK; prog++) {
      const key = slotKey(bank, prog);
      const planned = plan[key];
      if (planned === undefined) continue;
      const to = planned === INIT ? initId : planned;
      if (!to || synth.get(key) === to) continue;
      changes.push({ bank, prog, key, from: synth.get(key), to });
    }
  }
  return changes;
}

/** Sets a slot in the plan; planning what the synth already holds removes the entry (nothing to do). */
export function setPlanned(plan: BankPlan, key: string, planned: PlannedSlot | null, synth: ReadonlyMap<string, string>, initId: string | null): BankPlan {
  const next = { ...plan };
  const resolved = planned === INIT ? initId : planned;
  if (planned === null || (resolved !== null && synth.get(key) === resolved)) delete next[key];
  else next[key] = planned;
  return next;
}
