<script lang="ts">
  import { formatValue } from '../core/params/definitions';
  import type { MappedParam } from '../core/params/codec';
  import type { AppState } from './state.svelte';

  let { app, p, label = p.label }: { app: AppState; p: MappedParam; label?: string } = $props();

  const value = $derived(app.values[p.id] ?? p.min);
  const moved = $derived(app.panelMoved?.id === p.id);
  const choices = $derived(Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i));
</script>

<div class="control" class:moved title={moved ? 'Last moved on the synth' : undefined}>
  <span class="label">{label}</span>
  {#if p.kind === 'switch'}
    <button class="switch" class:on={value === 1} aria-pressed={value === 1} onclick={() => app.setParam(p.id, value ? 0 : 1)}>
      {value ? 'On' : 'Off'}
    </button>
  {:else if p.kind === 'choice'}
    <select value={value} onchange={(e) => app.setParam(p.id, Number(e.currentTarget.value))}>
      {#each choices as v (v)}
        <option value={v}>{formatValue(p, v)}</option>
      {/each}
    </select>
  {:else}
    <input
      type="range"
      min={p.min}
      max={p.max}
      value={value}
      oninput={(e) => app.setParam(p.id, Number(e.currentTarget.value))}
      ondblclick={() => p.center !== undefined && app.setParam(p.id, p.center)}
    />
    <span class="value">{formatValue(p, value)}</span>
  {/if}
</div>

<style>
  .control {
    display: grid;
    grid-template-columns: 96px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 2px 6px;
    border-radius: 6px;
    transition: background 0.6s;
  }
  .control.moved {
    background: var(--accent-soft);
    transition: none;
  }
  .label {
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
    padding: 0;
    border: none;
    background: none;
  }
  .value {
    font-family: var(--mono);
    font-size: 12px;
    min-width: 64px;
    text-align: right;
  }
  select {
    grid-column: 2 / 4;
    padding: 2px 6px;
  }
  .switch {
    grid-column: 2 / 4;
    justify-self: start;
    padding: 1px 12px;
    font-size: 13px;
  }
  .switch.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
</style>
