<script lang="ts">
  import { MAPPED, MAPPED_BY_ID } from '../core/params/codec';
  import { PARAMS, SECTIONS } from '../core/params/definitions';
  import { tagsFromValues } from '../core/library/autotags';
  import { suggestName } from '../core/library/namer';
  import ParamControl from './ParamControl.svelte';
  import type { AppState } from './state.svelte';

  let { app }: { app: AppState } = $props();

  let showAllSlots = $state(false);

  const sections = SECTIONS.filter((s) => s.id !== 'mod')
    .map((s) => ({ ...s, params: MAPPED.filter((p) => p.section === s.id) }))
    .filter((s) => s.params.length);
  const unmapped = PARAMS.filter((d) => !MAPPED_BY_ID.has(d.id));
  const slots = Array.from({ length: 16 }, (_, i) => i + 1).map((n) => ({
    n,
    source: MAPPED_BY_ID.get(`mod${n}.source`),
    amount: MAPPED_BY_ID.get(`mod${n}.amount`),
    dest: MAPPED_BY_ID.get(`mod${n}.dest`),
  }));
  const visibleSlots = $derived(showAllSlots ? slots : slots.filter((s) => (app.values[`mod${s.n}.source`] ?? 0) !== 0 || (app.values[`mod${s.n}.dest`] ?? 0) !== 0));

  const basedOnRow = $derived(app.basedOn ? app.rows.find((r) => r.id === app.basedOn) : undefined);

  let dice = 0;
  function rollName() {
    const seed = app.basedOn ?? app.selectedId ?? 'cafebabe';
    // Flavoured by the type of the sound being edited, as in the library.
    app.setName(suggestName(seed, tagsFromValues(app.values).category, app.liveNames(), dice++));
  }

  let nameDraft = $state('');
  $effect(() => {
    nameDraft = app.editorName;
  });
</script>

<div class="editor">
  <section class="panel">
    <div class="head">
      <div>
        <input
          class="name"
          maxlength="20"
          aria-label="Sound name"
          bind:value={nameDraft}
          onkeydown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              nameDraft = app.editorName;
              e.currentTarget.blur();
            }
          }}
          onblur={() => app.setName(nameDraft)}
        />
        <button class="dice" title="Random name (click again for another)" aria-label="Random name" onclick={rollName}>🎲</button>
        <p class="muted status">
          {#if app.synth}
            {app.syncing ? 'Reading the synth…' : app.mirrorLoaded ? 'Live: knob moves on the synth show here, and edits here go to the synth.' : 'Connecting to the synth…'}
          {:else}
            Synth not connected: editing offline. Changes are saved to the library when you update or save as new.
          {/if}
        </p>
        <p class="origin">
          {#if app.unchanged && basedOnRow}
            Unchanged from <strong>{basedOnRow.name}</strong>{basedOnRow.location ? ` (${basedOnRow.location})` : ''}
          {:else if basedOnRow}
            <span class="edited">Edited</span> from <strong>{basedOnRow.name}</strong>: update it, or save as a new patch.
          {:else}
            <span class="edited">Not in the library yet.</span> Save it as a new patch to keep it.
          {/if}
        </p>
      </div>
      <div class="actions">
        {#if basedOnRow}
          <button class="primary" disabled={app.unchanged} onclick={() => app.updateExisting()}
            title="Replace it in the library; the previous version is kept in its history">Update “{basedOnRow.name}”</button>
        {/if}
        <button class:primary={!basedOnRow} disabled={app.unchanged} onclick={() => app.saveAsNew()}>Save as new</button>
        <button disabled={app.unchanged || !app.basedOn || !app.synth} onclick={() => app.revert()} title="Send the original back to the synth">Revert</button>
        <button disabled={!app.synth || app.syncing} onclick={() => app.reconcile()} title="Read the synth's current sound">Re-read</button>
        <button class="close" aria-label="Close editor" onclick={() => app.setEditorOpen(false)}>✕</button>
      </div>
    </div>

    {#if MAPPED.length === 0}
      <p class="warn">No parameters are mapped yet: run <code>npm run tool -- map</code>.</p>
    {/if}

    <div class="grid">
      {#each sections as s (s.id)}
        <div class="card">
          <h3>{s.label}</h3>
          {#each s.params as p (p.id)}
            <ParamControl {app} {p} />
          {/each}
        </div>
      {/each}
    </div>

    <div class="card mod">
      <h3>
        Mod matrix
        <label class="muted"><input type="checkbox" bind:checked={showAllSlots} /> show empty slots</label>
      </h3>
      {#if visibleSlots.length === 0}
        <p class="muted">No modulation routed.</p>
      {/if}
      {#each visibleSlots as s (s.n)}
        <div class="slot-row">
          <span class="n">{s.n}</span>
          {#if s.source}<ParamControl {app} p={s.source} label="Source" />{/if}
          {#if s.amount}<ParamControl {app} p={s.amount} label="Amount" />{/if}
          {#if s.dest}<ParamControl {app} p={s.dest} label="Destination" />{/if}
        </div>
      {/each}
      <p class="muted small">Destination names are from the user's guide and not yet checked on the synth.</p>
    </div>

    {#if unmapped.length}
      <p class="muted small">Not yet mapped (edit these on the synth): {unmapped.map((d) => d.label).join(', ')}.</p>
    {/if}
  </section>
</div>

<style>
  .editor {
    height: 100%;
    min-height: 0;
  }
  .panel {
    height: 100%;
    overflow: auto;
    padding: 12px 16px;
  }
  .name {
    font-size: 20px;
    font-weight: 600;
    border-color: transparent;
    background: transparent;
    padding: 2px 6px;
    margin-left: -6px;
    width: 16em;
    max-width: 100%;
  }
  .name:hover,
  .name:focus {
    border-color: var(--line);
    background: var(--bg);
  }
  .dice {
    border: none;
    background: none;
    font-size: 18px;
    padding: 0 4px;
    vertical-align: middle;
  }
  .close {
    border: none;
    background: none;
    font-size: 16px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .status,
  .origin {
    margin: 4px 0 0;
    font-size: 13px;
  }
  .edited {
    color: var(--warn);
    font-weight: 500;
  }
  .actions {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 8px 6px;
  }
  .card h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0 6px 6px;
    display: flex;
    justify-content: space-between;
  }
  .card h3 label {
    text-transform: none;
    letter-spacing: 0;
    font-weight: normal;
  }
  .mod {
    margin-top: 12px;
  }
  .slot-row {
    display: grid;
    grid-template-columns: 24px repeat(3, minmax(0, 1fr));
    align-items: center;
    border-top: 1px solid var(--line);
    padding: 2px 0;
  }
  .n {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }
  .small {
    font-size: 12px;
  }
  .warn {
    color: var(--warn);
  }
  @media (max-width: 900px) {
    .slot-row {
      grid-template-columns: 24px 1fr;
    }
  }
</style>
