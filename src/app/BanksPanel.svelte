<script lang="ts">
  import { INIT } from '../core/library/banks';
  import { bankLabel, slotKey, slotLabel } from '../core/library/slots';
  import type { AppState } from './state.svelte';

  let { app }: { app: AppState } = $props();

  const PATCH_TYPE = 'application/x-take5-patch';
  const SLOT_TYPE = 'application/x-take5-slot';

  const byId = $derived(new Map(app.rows.map((r) => [r.id, r])));
  const initRow = $derived(app.initPatchId ? byId.get(app.initPatchId) : undefined);
  const changesPerBank = $derived(
    Array.from({ length: 16 }, (_, bank) => app.changes.filter((c) => c.bank === bank).length),
  );
  const slots = $derived(
    Array.from({ length: 16 }, (_, prog) => {
      const key = slotKey(app.bankView, prog);
      const current = app.synthSlots.get(key);
      const planned = app.plan[key];
      const plannedId = planned === INIT ? app.initPatchId : planned;
      return {
        key,
        prog,
        label: slotLabel(app.bankView, prog),
        current: current ? byId.get(current) : undefined,
        planned,
        target: plannedId ? byId.get(plannedId) : undefined,
        changed: planned !== undefined,
      };
    }),
  );

  let dropKey = $state<string | null>(null);
  let dialog: HTMLDialogElement;

  function accepts(e: DragEvent): boolean {
    const types = e.dataTransfer?.types ?? [];
    return types.includes(PATCH_TYPE) || types.includes(SLOT_TYPE);
  }

  function drop(e: DragEvent, key: string) {
    e.preventDefault();
    dropKey = null;
    const patch = e.dataTransfer?.getData(PATCH_TYPE);
    const from = e.dataTransfer?.getData(SLOT_TYPE);
    if (patch) app.planSlot(key, patch);
    else if (from && from !== key) app.swapSlots(from, key);
  }

  const name = (id: string | undefined) => (id ? (byId.get(id)?.name ?? '?') : 'unknown');
</script>

<div class="banks">
  <div class="head">
    <h2>Banks</h2>
    <select bind:value={app.bankView} aria-label="Bank">
      {#each changesPerBank as n, bank (bank)}
        <option value={bank}>Bank {bankLabel(bank)}{n ? ` · ${n} change${n === 1 ? '' : 's'}` : ''}</option>
      {/each}
    </select>
    <button disabled={!app.synth || app.busy} onclick={() => app.readBank(app.bankView)} title="Read this bank's 16 slots from the synth (about 25 s)">
      {app.bankReading ? `Reading ${app.bankReading.done}/16…` : 'Re-read bank'}
    </button>
    <button disabled={!app.initPatchId} onclick={() => app.initBank(app.bankView)} title={app.initPatchId ? '' : 'Set an Init patch first'}>Init whole bank</button>
    <button disabled={!changesPerBank[app.bankView]} onclick={() => app.revertBank(app.bankView)}>Revert bank</button>
    <span class="spacer"></span>
    <button class="primary" disabled={!app.changes.length || !app.synth || app.busy} onclick={() => dialog.showModal()}
      title={app.synth ? '' : 'Connect the synth first'}>
      Push {app.changes.length} change{app.changes.length === 1 ? '' : 's'}…
    </button>
    <button class="close" aria-label="Close banks" onclick={() => app.setBanksOpen(false)}>✕</button>
  </div>

  <p class="init muted">
    {#if initRow}
      Init patch: <strong>{initRow.name}</strong>.
      <button class="link" disabled={!app.synth || app.busy} onclick={() => app.captureInit()}>Capture again</button>
    {:else}
      <strong class="warn">No Init patch yet.</strong> On the synth: <em>Global → Basic Program → Write</em> (loads it as the current
      sound; saves nothing), then
      <button class="link" disabled={!app.synth || app.busy} onclick={() => app.captureInit()}>capture it</button>.
    {/if}
    {#if app.selected && app.selected.id !== app.initPatchId}
      Or <button class="link" onclick={() => app.setInitPatch(app.selected!.id)}>use “{app.selected.name}” as Init</button>.
    {/if}
  </p>

  {#if app.pushing}
    <div class="progress">
      <progress max={app.pushing.total} value={app.pushing.done}></progress>
      <span>{app.pushing.step}… ({app.pushing.done}/{app.pushing.total})</span>
    </div>
  {/if}

  {#if !app.loaded}<p class="muted">Loading…</p>{/if}
  <div class="grid" hidden={!app.loaded}>
    {#each slots as s (s.key)}
      <div
        class="slot"
        class:changed={s.changed}
        class:drop={dropKey === s.key}
        role="listitem"
        draggable="true"
        ondragstart={(e) => e.dataTransfer?.setData(SLOT_TYPE, s.key)}
        ondragover={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          dropKey = s.key;
        }}
        ondragleave={() => (dropKey = dropKey === s.key ? null : dropKey)}
        ondrop={(e) => drop(e, s.key)}
      >
        <div class="top">
          <span class="label">{s.label}</span>
          {#if s.planned === INIT}<span class="badge">Init</span>{:else if s.changed}<span class="badge">new</span>{/if}
        </div>
        <button class="name" onclick={() => (s.target ?? s.current) && app.select((s.target ?? s.current)!.id)}>
          {#if s.changed}
            {s.planned === INIT ? (initRow?.name ?? 'Init') : (s.target?.name ?? '?')}
          {:else}
            {s.current?.name ?? 'not read yet'}
          {/if}
        </button>
        {#if s.changed}<div class="was muted">was {s.current?.name ?? 'unknown'}</div>{/if}
        <div class="actions">
          <button class="link" disabled={!app.initPatchId || s.planned === INIT} onclick={() => app.planSlot(s.key, INIT)}>Init</button>
          <button class="link" disabled={!s.changed} onclick={() => app.planSlot(s.key, null)}>Revert</button>
        </div>
      </div>
    {/each}
  </div>
  <p class="muted small">
    Drag patches from the library list onto a slot; drag one slot onto another to swap them. Changes are kept here until you push.
  </p>
</div>

<dialog bind:this={dialog} class="confirm">
  <h3>Write {app.changes.length} slot{app.changes.length === 1 ? '' : 's'} to the synth?</h3>
  <p>This replaces those programs in the synth's memory. Each slot is backed up into the library first, and every write is checked by reading it back.</p>
  <ul>
    {#each app.changes as c (c.key)}
      <li><span class="mono">{slotLabel(c.bank, c.prog)}</span> {name(c.from)} → <strong>{name(c.to)}</strong></li>
    {/each}
  </ul>
  <div class="dialog-actions">
    <button onclick={() => dialog.close()}>Cancel</button>
    <button
      class="primary"
      onclick={() => {
        dialog.close();
        void app.push(app.changes);
      }}>Write {app.changes.length} slot{app.changes.length === 1 ? '' : 's'}</button
    >
  </div>
</dialog>

<style>
  .banks {
    height: 100%;
    overflow: auto;
    padding: 12px 16px;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0 8px 0 0;
    font-size: 18px;
  }
  .spacer {
    flex: 1;
  }
  .close {
    border: none;
    background: none;
    font-size: 16px;
  }
  .init {
    font-size: 13px;
    margin: 8px 0;
  }
  .warn {
    color: var(--warn);
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .link:disabled {
    color: var(--muted);
    text-decoration: none;
  }
  .progress {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 8px;
  }
  .slot {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    cursor: grab;
  }
  .slot.changed {
    border-color: var(--accent);
    background: var(--select);
  }
  .slot.drop {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  .top {
    display: flex;
    justify-content: space-between;
  }
  .label {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .badge {
    font-size: 11px;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 0 6px;
  }
  .name {
    border: none;
    background: none;
    padding: 0;
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .was {
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 12px;
    font-size: 12px;
  }
  .small {
    font-size: 12px;
  }
  .confirm {
    max-width: 520px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
  }
  .confirm ul {
    max-height: 300px;
    overflow: auto;
    padding-left: 18px;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .mono {
    font-family: var(--mono);
  }
</style>
