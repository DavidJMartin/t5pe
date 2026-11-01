// App state (Svelte 5 runes). Everything durable lives in the Library; this holds the view.
import { autoTags } from '../core/library/autotags';
import { guessCategory, type Category } from '../core/library/category';
import { backupDate, parseSyx } from '../core/library/import';
import { bankLabel, isFactoryBank, slotKey, slotLabel } from '../core/library/slots';
import type { Provenance } from '../core/library/types';
import { currentSynthSlots, INIT, planChanges, setPlanned, type BankPlan, type PlannedSlot, type SlotChange } from '../core/library/banks';
import { currentVersion } from '../core/library/history';
import { suggestName } from '../core/library/namer';
import { decode, MAPPED_BY_NRPN, type ParamValues } from '../core/params/codec';
import { patchId } from '../core/patch/hash';
import { readName, sanitizeName, writeName } from '../core/patch/name';
import { NAME_LENGTH } from '../core/sysex/constants';
import { EditBufferMirror } from '../core/sync/editBuffer';
import { Synth, type ReadProgress } from '../midi/synth';
import { Library, requestPersistentStorage, type PatchWithProvenance } from '../storage/library';
import { LibraryFolder, type FolderStatus } from '../storage/folder';
import { Generator } from './generator.svelte';

export type Origin = 'all' | 'user' | 'factory' | 'files' | 'generated';
export type View = 'library' | 'bin';
export type Sort = 'slot' | 'name' | 'added';

export interface Row extends PatchWithProvenance {
  category: Category | null;
  origins: Set<Exclude<Origin, 'all'>>;
  /** Where it was most recently seen on the synth, e.g. "A-07", or "8 slots". */
  location: string;
  /** Sort key: first synth slot, else after all slots. */
  slotOrder: number;
  /** In the most recent synth read/backup. False for patches that were on the synth before but aren't now. */
  onSynth: boolean;
  /** An updated version of a patch from a synth slot: `location` is the original's slot. */
  editedVersion: boolean;
  /** Rule-based tags from the sound's parameters (core/library/autotags.ts), recomputed on load. */
  tags: string[];
  /** Category from the auto-tagger (for name flavour); null if unclear. */
  autoCategory: string | null;
}

const EDITOR_KEY = 'take5.editorOpen';
const BANKS_KEY = 'take5.banksOpen';
const GENERATE_KEY = 'take5.generateOpen';
const PLAN_SETTING = 'bankPlan';
const INIT_SETTING = 'initPatchId';
const SPLIT_KEY = 'take5.editorSplit';
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export class AppState {
  readonly library = new Library();
  readonly folder: LibraryFolder;

  rows = $state.raw<Row[]>([]);
  loaded = $state(false);
  selectedId = $state<string | null>(null);

  query = $state('');
  origin = $state<Origin>('all');
  category = $state<Category | 'all' | 'none'>('all');
  heartedOnly = $state(false);
  /** Show only patches with all of these tags. */
  tagFilter = $state<string[]>([]);
  view = $state<View>('library');
  sort = $state<Sort>('slot');

  synth = $state.raw<Synth | null>(null);
  connecting = $state(false);
  synthError = $state<string | null>(null);
  auditionOn = $state(false);
  lastAuditioned = $state<string | null>(null);

  reading = $state<ReadProgress | null>(null);
  private readAbort?: AbortController;

  /** The editor panel under the library. */
  editorOpen = $state(stored(EDITOR_KEY) === '1');
  /** The Banks panel (shares the bottom dock with the editor). */
  banksOpen = $state(stored(BANKS_KEY) === '1');
  /** The Generate panel (shares the bottom dock). */
  generateOpen = $state(stored(GENERATE_KEY) === '1');
  readonly generator: Generator = new Generator(this);
  /** User bank shown in the Banks panel (0–15). */
  bankView = $state(0);
  /** What each slot holds on the synth ("bank:prog" → patch id), from the latest snapshot covering it. */
  synthSlots = $state.raw<Map<string, string>>(new Map());
  /** Pending slot changes, kept until pushed (persisted in the library's settings). */
  plan = $state.raw<BankPlan>({});
  initPatchId = $state<string | null>(null);
  changes = $derived(planChanges(this.plan, this.synthSlots, this.initPatchId));
  pushing = $state<{ done: number; total: number; step: string } | null>(null);
  bankReading = $state<{ bank: number; done: number } | null>(null);
  /** Fraction of the height the editor panel takes. */
  editorSplit = $state(Number(stored(SPLIT_KEY)) || 0.5);

  /** The synth's edit buffer as we believe it to be (design.md §4.2). */
  readonly mirror = new EditBufferMirror();
  /** Decoded values of `mirror`, for the editor to render. */
  values = $state.raw<ParamValues>({});
  editorName = $state('');
  /** Library patch the current sound is based on, and whether it's unchanged from it. */
  basedOn = $state<string | null>(null);
  unchanged = $state(false);
  /** Whether `mirror` has been read from the synth since connecting. */
  mirrorLoaded = $state(false);
  syncing = $state(false);
  /** Parameter last moved on the synth's panel, for highlighting. */
  panelMoved = $state<{ id: string; at: number } | null>(null);
  private editSeq = 0;
  private reconcileTimer?: ReturnType<typeof setTimeout>;

  folderStatus = $state<FolderStatus>({ state: 'none' });
  notice = $state<{ text: string; kind: 'info' | 'error' } | null>(null);

  visible = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    const rows = this.rows.filter((r) => {
      if (this.view === 'bin' ? !r.binnedAt : r.binnedAt || r.supersededBy) return false;
      if (this.heartedOnly && !r.hearted) return false;
      if (this.tagFilter.length && !this.tagFilter.every((t) => r.tags.includes(t))) return false;
      if (this.origin !== 'all' && !r.origins.has(this.origin)) return false;
      if (this.category === 'none' ? r.category !== null : this.category !== 'all' && r.category !== this.category) return false;
      return !q || r.name.toLowerCase().includes(q) || r.location.toLowerCase() === q;
    });
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      slot: (a, b) => a.slotOrder - b.slotOrder || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      added: (a, b) => b.createdAt - a.createdAt || a.slotOrder - b.slotOrder,
    };
    return rows.sort(by[this.sort]);
  });

  selected = $derived(this.rows.find((r) => r.id === this.selectedId) ?? null);

  constructor() {
    this.folder = new LibraryFolder(this.library, (s) => this.onFolderStatus(s));
    this.library.onChange(() => void this.reload());
  }

  /** The synth is busy with a bulk read or a push: no auditions, edits or re-reads meanwhile. */
  get busy(): boolean {
    return !!this.reading || !!this.pushing || !!this.bankReading;
  }

  async init(): Promise<void> {
    this.plan = (await this.library.getSetting<BankPlan>(PLAN_SETTING)) ?? {};
    this.initPatchId = (await this.library.getSetting<string>(INIT_SETTING)) ?? null;
    await this.reload();
    this.loaded = true;
    await this.folder.init();
  }

  private reloadSeq = 0;

  async reload(): Promise<void> {
    const seq = ++this.reloadSeq;
    const all = await this.library.all();
    if (seq !== this.reloadSeq) return; // a newer reload is in flight
    const synthSlots = currentSynthSlots(await this.library.snapshots());
    if (seq !== this.reloadSeq) return;
    const slotsOf = new Map<string, [number, number][]>();
    for (const [key, id] of synthSlots) slotsOf.set(id, [...(slotsOf.get(id) ?? []), key.split(':').map(Number) as [number, number]]);
    const rows = all.map((p) => toRow(p, slotsOf.get(p.id) ?? []));
    this.synthSlots = synthSlots;
    inheritSlots(rows);
    this.rows = rows;
  }

  select(id: string | null, audition = true): void {
    this.selectedId = id;
    if (audition && id) this.audition(id);
  }

  /** Moves the selection within the visible list (arrow keys). */
  step(delta: number): void {
    const list = this.visible;
    if (list.length === 0) return;
    const i = list.findIndex((r) => r.id === this.selectedId);
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + delta))];
    this.select(next.id);
  }

  audition(id: string, force = false): void {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    if (!this.synth || this.busy || (!this.auditionOn && !force)) {
      // Without the synth, the editor still opens the selected patch, for offline editing.
      if (this.editorOpen && !this.synth) this.loadIntoEditor(row.data, row.id);
      return;
    }
    this.synth.audition(row.data);
    this.lastAuditioned = id;
    this.editSeq++;
    this.loadIntoEditor(row.data, row.id);
    // Confirm what the synth actually has once browsing pauses (a dump sent too soon can be ignored, protocol.md §4.3).
    this.scheduleReconcile(1800);
  }

  // ---- Editor and live sync ----

  /** Shows `data` in the editor as the current sound. */
  private loadIntoEditor(data: Uint8Array, basedOn: string | null): void {
    this.mirror.replace(data, basedOn);
    void this.refreshEditor();
  }

  private async refreshEditor(): Promise<void> {
    this.values = decode(this.mirror.data);
    this.editorName = readName(this.mirror.data);
    const id = await patchId(this.mirror.data);
    const match = this.rows.find((r) => r.id === id);
    if (match) this.mirror.basedOn = match.id;
    this.basedOn = this.mirror.basedOn;
    this.unchanged = !!match;
  }

  /** A change made on screen: update the mirror and send it to the synth. */
  setParam(id: string, value: number): void {
    const out = this.mirror.setFromScreen(id, value);
    if (!out) return;
    this.editSeq++;
    if (this.synth && !this.busy) {
      if (out.kind === 'nrpn') this.synth.sendNrpn(out.nrpn, out.value);
      else this.synth.audition(out.data);
      this.scheduleReconcile(1200);
    }
    void this.refreshEditor();
  }

  private onPanelNrpn(nrpn: number, value: number): void {
    const id = this.mirror.applyNrpn(nrpn, value);
    this.editSeq++;
    if (id) {
      this.panelMoved = { id, at: Date.now() };
      void this.refreshEditor();
    } else if (!MAPPED_BY_NRPN.has(nrpn)) {
      console.info(`Take 5 sent NRPN ${nrpn} = ${value}, which isn't mapped yet`);
    }
    this.scheduleReconcile(1200);
  }

  /** Re-reads the edit buffer after `delayMs`, unless something newer is scheduled first. */
  scheduleReconcile(delayMs: number): void {
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => void this.reconcile(), delayMs);
  }

  /** Reads the synth's edit buffer and adopts it (the synth is the source of truth). */
  async reconcile(): Promise<void> {
    const synth = this.synth;
    if (!synth || this.busy || this.syncing) return;
    this.syncing = true;
    try {
      const seq = this.editSeq;
      const data = await synth.readEditBuffer();
      // Edits made while the read was in flight aren't in it; try again once things settle.
      if (seq !== this.editSeq || synth.sending) return this.scheduleReconcile(800);
      const changed = this.mirror.replace(data, this.mirrorLoaded ? undefined : null);
      if (changed.length && this.mirrorLoaded) console.info(`re-read: the synth differed in ${changed.join(', ')}`);
      this.mirrorLoaded = true;
      await this.refreshEditor();
    } catch (err) {
      this.flash(`Couldn't read the synth's current sound: ${String(err)}`, 'error');
    } finally {
      this.syncing = false;
    }
  }

  /** `loadSelection`: show the selected library patch when the synth isn't there to read from. */
  setEditorOpen(open: boolean, loadSelection = true): void {
    this.editorOpen = open;
    if (open) this.banksOpen = this.generateOpen = false;
    this.rememberDock();
    if (!open) return;
    if (this.synth) this.scheduleReconcile(0);
    else if (loadSelection && this.selected) this.loadIntoEditor(this.selected.data, this.selected.id);
  }

  setBanksOpen(open: boolean): void {
    this.banksOpen = open;
    if (open) this.editorOpen = this.generateOpen = false;
    this.rememberDock();
  }

  setGenerateOpen(open: boolean): void {
    this.generateOpen = open;
    if (open) this.editorOpen = this.banksOpen = false;
    this.rememberDock();
  }

  /** The Init patch's data: the one chosen in the Banks panel, else the "-" placeholder. */
  initPatchData(): Uint8Array | null {
    const init = (this.initPatchId && this.rows.find((r) => r.id === this.initPatchId)) || this.rows.find((r) => r.name === '-' && !r.binnedAt);
    return init ? init.data : null;
  }

  /** Puts a sound on the synth (if connected) and in the editor, without saving it anywhere. */
  playAndShow(data: Uint8Array, basedOn: string | null): void {
    if (this.synth && !this.busy) {
      this.synth.audition(data);
      this.editSeq++;
      this.scheduleReconcile(1800);
    }
    this.loadIntoEditor(data, basedOn);
  }

  /** Starts a new sound from the Init patch, with a random name, on the synth and in the editor. */
  newPatch(): void {
    const init = this.initPatchData();
    if (!init) return this.flash('Set an Init patch first (Banks panel), or keep a "-" patch in the library.', 'error');
    const name = suggestName(Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0'), null, this.liveNames());
    this.setEditorOpen(true, false);
    this.playAndShow(writeName(init, name), null);
    this.flash(`New patch "${name}" from Init${this.synth ? ', loaded on the synth' : ''}. Save it as new when you like it.`);
  }

  private rememberDock(): void {
    try {
      localStorage.setItem(EDITOR_KEY, this.editorOpen ? '1' : '0');
      localStorage.setItem(BANKS_KEY, this.banksOpen ? '1' : '0');
      localStorage.setItem(GENERATE_KEY, this.generateOpen ? '1' : '0');
    } catch {
      // per-browser convenience only
    }
  }

  // ---- Banks: plan, Init, push (design.md §3.5) ----

  /** Plans a slot: a patch id, INIT, or null to revert to what the synth holds. */
  planSlot(key: string, planned: PlannedSlot | null): void {
    this.setPlan(setPlanned(this.plan, key, planned, this.synthSlots, this.initPatchId));
  }

  /** What a slot will hold after a push: the planned patch, else what's on the synth. */
  plannedOrCurrent(key: string): PlannedSlot | undefined {
    return this.plan[key] ?? this.synthSlots.get(key);
  }

  initBank(bank: number): void {
    let plan = this.plan;
    for (let prog = 0; prog < 16; prog++) plan = setPlanned(plan, slotKey(bank, prog), INIT, this.synthSlots, this.initPatchId);
    this.setPlan(plan);
  }

  revertBank(bank: number): void {
    const plan = { ...this.plan };
    for (let prog = 0; prog < 16; prog++) delete plan[slotKey(bank, prog)];
    this.setPlan(plan);
  }

  /** Swaps what two slots will hold (dragging one slot onto another). */
  swapSlots(a: string, b: string): void {
    const va = this.plannedOrCurrent(a) ?? null;
    const vb = this.plannedOrCurrent(b) ?? null;
    let plan = setPlanned(this.plan, a, vb, this.synthSlots, this.initPatchId);
    plan = setPlanned(plan, b, va, this.synthSlots, this.initPatchId);
    this.setPlan(plan);
  }

  private setPlan(plan: BankPlan): void {
    this.plan = plan;
    void this.library.setSetting(PLAN_SETTING, plan);
  }

  async setInitPatch(id: string): Promise<void> {
    this.initPatchId = id;
    await this.library.setSetting(INIT_SETTING, id);
    // Plans made before the Init patch was known may now be no-ops (the slot already holds Init).
    this.setPlan(Object.fromEntries(Object.entries(this.plan).filter(([key, v]) => !(v === INIT && this.synthSlots.get(key) === id))));
  }

  /** Reads the synth's current sound and makes it the Init patch (after the user loads Global → Basic Program). */
  async captureInit(): Promise<void> {
    if (!this.synth || this.busy) return;
    const data = await this.synth.readEditBuffer();
    const { id } = await this.library.keep(data, [], 'Init captured from the synth (Basic Program)');
    await this.reload();
    await this.setInitPatch(id);
    this.flash(`Init patch set to "${readName(data)}", captured from the synth.`);
  }

  /** Re-reads one bank's 16 slots from the synth, so the Banks panel shows exactly what's there. */
  async readBank(bank: number): Promise<void> {
    if (!this.synth || this.busy) return;
    const at = Date.now();
    const dumps: { data: Uint8Array; bank: number; prog: number }[] = [];
    this.bankReading = { bank, done: 0 };
    try {
      for (let prog = 0; prog < 16; prog++) {
        dumps.push({ data: await this.synth.readProgram(bank, prog), bank, prog });
        this.bankReading = { bank, done: prog + 1 };
      }
      const label = `Read bank ${bankLabel(bank)} ${new Date(at).toLocaleString()}`;
      const summary = await this.library.importPatches(dumps, { kind: 'synth', source: label, at, snapshot: true });
      this.flash(`Bank ${bankLabel(bank)} re-read from the synth${summary.added ? `: ${summary.added} patches weren't in the library and have been added` : ''}.`);
    } catch (err) {
      this.flash(`Reading bank ${bankLabel(bank)} failed: ${String(err)}`, 'error');
    } finally {
      this.bankReading = null;
    }
  }

  /**
   * WRITES THE SYNTH'S MEMORY. Called only after the user confirms the exact list of changes.
   * 1. Keeps the synth's current sound if it isn't in the library (writing the selected slot replaces it).
   * 2. Re-reads every target slot and snapshots it ("Before push"), so nothing is lost and it can be undone.
   * 3. Writes each slot and verifies it by reading back.
   * 4. Snapshots what was written ("After push") and clears those slots from the plan.
   */
  async push(changes: SlotChange[]): Promise<void> {
    const synth = this.synth;
    if (!synth || this.busy || changes.length === 0) return;
    const stamp = new Date().toLocaleString();
    const byId = new Map(this.rows.map((r) => [r.id, r]));
    const total = changes.length;
    this.pushing = { done: 0, total, step: 'Saving the current sound' };
    const written: { data: Uint8Array; bank: number; prog: number; key: string }[] = [];
    const failed: string[] = [];
    try {
      const current = await synth.readEditBuffer();
      if (!byId.has(await patchId(current))) await this.library.keep(current, [], `sound on the synth before the push of ${stamp}`);

      const before: { data: Uint8Array; bank: number; prog: number }[] = [];
      for (const [i, c] of changes.entries()) {
        this.pushing = { done: i, total, step: `Backing up ${slotLabel(c.bank, c.prog)}` };
        before.push({ data: await synth.readProgram(c.bank, c.prog), bank: c.bank, prog: c.prog });
      }
      await this.library.importPatches(before, { kind: 'synth', source: `Before push ${stamp}`, at: Date.now(), snapshot: true });

      for (const [i, c] of changes.entries()) {
        const patch = byId.get(c.to) ?? (await this.library.all()).find((p) => p.id === c.to);
        const label = slotLabel(c.bank, c.prog);
        this.pushing = { done: i, total, step: `Writing ${label}` };
        if (!patch) {
          failed.push(`${label} (patch missing)`);
          continue;
        }
        const ok = await synth.writeProgram(c.bank, c.prog, patch.data);
        if (ok) written.push({ data: patch.data, bank: c.bank, prog: c.prog, key: c.key });
        else failed.push(label);
      }
      this.pushing = { done: total, total, step: 'Recording the result' };
      if (written.length) await this.library.importPatches(written, { kind: 'synth', source: `After push ${stamp}`, at: Date.now(), snapshot: true });
      const plan = { ...this.plan };
      for (const w of written) delete plan[w.key];
      this.setPlan(plan);
      this.flash(
        failed.length
          ? `Wrote ${written.length} of ${total} slots. Not verified: ${failed.join(', ')}. Those stay planned; push again to retry.`
          : `Pushed ${written.length} slot${written.length === 1 ? '' : 's'}, each verified by reading it back. Everything replaced is saved as "Before push ${stamp}".`,
        failed.length ? 'error' : 'info',
      );
    } catch (err) {
      this.flash(`Push stopped: ${String(err)}. ${written.length} slots were written and verified; the rest stay planned.`, 'error');
    } finally {
      this.pushing = null;
      this.scheduleReconcile(500); // writing the selected slot replaces the current sound (protocol.md §4.2)
    }
  }

  // ---- Naming (design.md §3.8) ----

  /** Names currently shown in the library (not counting superseded or binned versions). */
  liveNames(exceptId?: string): Set<string> {
    return new Set(this.rows.filter((r) => !r.supersededBy && !r.binnedAt && r.id !== exceptId).map((r) => r.name));
  }

  /** A random two-word name idea for a patch; `attempt` > 0 for "another". */
  nameIdea(row: Row, attempt = 0): string {
    return suggestName(row.id, row.autoCategory, this.liveNames(row.id), attempt);
  }

  setEditorSplit(fraction: number): void {
    this.editorSplit = Math.min(0.85, Math.max(0.2, fraction));
    try {
      localStorage.setItem(SPLIT_KEY, String(this.editorSplit));
    } catch {
      // per-browser convenience only
    }
  }

  /** Renames the current sound (sent to the synth too, so its display matches). */
  setName(name: string): void {
    const out = this.mirror.setName(sanitizeName(name));
    if (!out) return;
    this.editSeq++;
    if (out.kind === 'dump' && this.synth && !this.busy) {
      this.synth.audition(out.data);
      this.scheduleReconcile(1800);
    }
    void this.refreshEditor();
  }

  /** Opens a library patch in the editor without the synth (or alongside it, if auditioning). */
  edit(id: string): void {
    this.setEditorOpen(true);
    this.selectedId = id;
    this.audition(id, true);
    const row = this.rows.find((r) => r.id === id);
    if (row && !this.synth) this.loadIntoEditor(row.data, row.id);
  }

  /** Saves the current sound to the library as a new patch, linked to the patch it was based on. */
  async saveAsNew(): Promise<void> {
    const parent = this.mirror.basedOn;
    const parentName = parent ? this.rows.find((r) => r.id === parent)?.name : undefined;
    // An edited sound that still has its parent's name gets a version suffix, so the two are distinguishable.
    let data = this.mirror.data;
    if (parentName !== undefined && readName(data) === parentName) {
      const names = new Set(this.rows.map((r) => r.name));
      const base = parentName.replace(/ v\d+$/, '');
      let n = 2;
      const named = (k: number) => `${base.slice(0, NAME_LENGTH - ` v${k}`.length)} v${k}`;
      while (names.has(named(n))) n++;
      data = writeName(data, named(n));
      this.mirror.replace(data);
      this.synth?.audition(data); // keep the synth's edit buffer identical to what we saved
    }
    const { id, isNew } = await this.library.keep(data, parent ? [parent] : [], parentName ? `edited from "${parentName}"` : 'edited on the synth');
    await this.reload();
    this.mirror.basedOn = id;
    this.selectedId = id;
    await this.refreshEditor();
    this.flash(isNew ? `Saved "${this.editorName}" as a new patch${parentName ? `, linked to "${parentName}"` : ''}.` : 'This exact sound is already in the library.');
  }

  /**
   * Replaces the patch the current sound was based on with this version. The list shows only the new
   * version; the previous one is kept as its history (see Library.update).
   */
  async updateExisting(): Promise<void> {
    const original = this.mirror.basedOn ? this.rows.find((r) => r.id === this.mirror.basedOn) : undefined;
    if (!original) return;
    const id = await this.library.update(original.id, this.mirror.data, 'updated in the editor');
    await this.reload();
    this.mirror.basedOn = id;
    this.selectedId = id;
    await this.refreshEditor();
    this.flash(`Updated "${this.editorName}". The previous version is kept in its history.`);
  }

  /**
   * Makes an earlier version of a patch current again. Saved as a new entry at the top of its history;
   * the version it replaces stays in the history.
   */
  async restoreVersion(versionId: string, savedAt: number): Promise<void> {
    const current = currentVersion(versionId, this.rows);
    if (current === versionId) return;
    const id = await this.library.restoreVersion(current, versionId);
    await this.reload();
    this.select(id);
    if (this.editorOpen && (!this.synth || !this.auditionOn)) this.loadIntoEditor(this.rows.find((r) => r.id === id)!.data, id);
    this.flash(`Restored the version from ${new Date(savedAt).toLocaleString()}. The version it replaced is kept in the history.`);
  }

  /** Puts back the patch the current sound was based on. */
  revert(): void {
    const id = this.mirror.basedOn;
    if (id) this.audition(id, true);
  }

  async connect(): Promise<void> {
    this.connecting = true;
    this.synthError = null;
    try {
      const synth = await Synth.connect();
      synth.onSendError = (err) => this.flash(`Sending to the synth failed: ${String(err)}`, 'error');
      synth.onNrpn = (nrpn, value) => this.onPanelNrpn(nrpn, value);
      synth.onProgramChange = () => {
        this.editSeq++;
        this.mirror.basedOn = null;
        this.scheduleReconcile(100);
      };
      this.synth = synth;
      void this.reconcile();
      window.addEventListener('focus', () => this.scheduleReconcile(100));
    } catch (err) {
      this.synthError = err instanceof Error ? err.message : String(err);
    } finally {
      this.connecting = false;
    }
  }

  async importFiles(files: Iterable<File>): Promise<void> {
    const lines: string[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.syx')) {
        lines.push(`${file.name}: not a .syx file, skipped`);
        continue;
      }
      const parsed = parseSyx(new Uint8Array(await file.arrayBuffer()));
      if (parsed.patches.length === 0) {
        lines.push(`${file.name}: no Take 5 patches found`);
        continue;
      }
      const date = backupDate(file.name);
      const summary = await this.library.importPatches(
        parsed.patches,
        date
          ? { kind: 'synth', source: `Backup ${file.name}`, at: date.getTime(), snapshot: true }
          : { kind: 'file', source: file.name, at: file.lastModified },
      );
      lines.push(`${file.name}: ${summary.total} patches, ${summary.added} new${parsed.warnings.length ? ` (${parsed.warnings.length} warnings)` : ''}`);
    }
    await requestPersistentStorage();
    this.flash(lines.join(' · ') || 'Nothing imported');
  }

  async readSynth(): Promise<void> {
    if (!this.synth || this.busy) return;
    const started = new Date();
    this.readAbort = new AbortController();
    this.reading = { done: 0, total: 512, bank: 0, prog: 0 };
    try {
      const { dumps, missing } = await this.synth.readAll((p) => (this.reading = p), this.readAbort.signal);
      const partial = this.readAbort.signal.aborted || missing.length > 0;
      const source = `Read synth ${started.toLocaleString()}${partial ? ' (partial)' : ''}`;
      const summary = await this.library.importPatches(dumps, { kind: 'synth', source, at: started.getTime(), snapshot: true });
      await requestPersistentStorage();
      this.flash(`${source}: ${summary.total} programs, ${summary.added} new${missing.length ? `, ${missing.length} slots did not answer` : ''}`);
    } catch (err) {
      this.flash(`Read failed: ${String(err)}`, 'error');
    } finally {
      this.reading = null;
    }
  }

  cancelRead(): void {
    this.readAbort?.abort();
  }

  async rename(id: string, name: string): Promise<void> {
    const newId = await this.library.rename(id, name);
    await this.reload();
    if (this.selectedId === id) this.selectedId = newId;
  }

  private onFolderStatus(status: FolderStatus): void {
    this.folderStatus = status;
    if (status.state !== 'ok') return;
    const { loaded, updated, unindexed, problems } = status.last;
    const parts = [
      loaded && `loaded ${loaded} patches from the library folder`,
      updated && `${updated} updated from changes made elsewhere`,
      unindexed && `${unindexed} recovered from .syx files`,
    ].filter(Boolean);
    if (problems.length) this.flash(`Library folder: ${[...parts, ...problems].join('; ')}`, 'error');
    else if (parts.length) this.flash(`Library folder: ${parts.join('; ')}.`);
  }

  flash(text: string, kind: 'info' | 'error' = 'info'): void {
    this.notice = { text, kind };
  }
}

function toRow(p: PatchWithProvenance, currentSlots: [number, number][]): Row {
  const origins = new Set<Exclude<Origin, 'all'>>();
  for (const pr of p.provenance) {
    if (pr.kind === 'file') origins.add('files');
    if (pr.kind === 'generated') origins.add('generated');
    if (pr.kind === 'synth' && pr.bank !== undefined) origins.add(isFactoryBank(pr.bank) ? 'factory' : 'user');
  }
  // Where it is now (from what each slot currently holds); otherwise where it was last seen.
  const onSynth = currentSlots.length > 0;
  const slots: [number, number][] = onSynth
    ? [...currentSlots].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    : latestSynthSlots(p.provenance).map((pr) => [pr.bank!, pr.prog!]);
  const where = slots.length === 0 ? '' : slots.length === 1 ? slotLabel(slots[0][0], slots[0][1]) : `${slots.length} slots`;
  return {
    ...p,
    category: guessCategory(p.name),
    origins,
    location: where && !onSynth ? `was ${where}` : where,
    slotOrder: slots.length ? (onSynth ? 0 : 1000) + slots[0][0] * 16 + slots[0][1] : 10_000,
    onSynth,
    editedVersion: false,
    ...(({ tags, category }) => ({ tags, autoCategory: category }))(autoTags(p.data)),
  };
}

/**
 * An updated version of a synth patch has never been on the synth itself, but it stands in for the patch
 * in that slot: show the original's slot, and sort it there.
 */
function inheritSlots(rows: Row[]): void {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const predecessor = (r: Row) => r.parentIds.map((id) => byId.get(id)).find((p) => p?.supersededBy === r.id);
  for (const r of rows) {
    if (r.location) continue;
    const seen = new Set<string>();
    let p = predecessor(r);
    while (p && !p.location && !seen.has(p.id)) {
      seen.add(p.id);
      p = predecessor(p);
    }
    if (!p?.location) continue;
    r.location = `${p.location} · edited`;
    r.slotOrder = p.slotOrder;
    r.editedVersion = true;
  }
}

/** Slots from the most recent synth read or backup that contained this patch. */
export function latestSynthSlots(provenance: Provenance[]): Provenance[] {
  const synth = provenance.filter((p) => p.kind === 'synth' && p.bank !== undefined && p.prog !== undefined);
  if (synth.length === 0) return [];
  const latest = Math.max(...synth.map((p) => p.at));
  return synth.filter((p) => p.at === latest).sort((a, b) => a.bank! - b.bank! || a.prog! - b.prog!);
}
