<script lang="ts">
  import type { GenMode } from './generator.svelte';
  import type { AppState } from './state.svelte';

  let { app }: { app: AppState } = $props();
  const g = $derived(app.generator);

  const modes: [GenMode, string, string][] = [
    ['library', 'From the library', 'New patches built from sections of different library patches, roughened by wildness.'],
    ['favourites', 'From favourites', 'Children of your hearted patches: sections mixed between two parents, then mutated.'],
    ['mutate', 'Mutate', 'Variations around one patch. Low amounts nudge; high amounts reassign choices and rewire modulation.'],
  ];
  const wildLabel = $derived(g.mode === 'mutate' ? 'Amount' : 'Wildness');
</script>

<div class="gen">
  <div class="head">
    <h2>Generate</h2>
    <div class="modes" role="tablist">
      {#each modes as [m, label] (m)}
        <button role="tab" aria-selected={g.mode === m} class:active={g.mode === m} onclick={() => (g.mode = m)}>{label}</button>
      {/each}
    </div>
    <span class="spacer"></span>
    <button class="close" aria-label="Close" onclick={() => app.setGenerateOpen(false)}>✕</button>
  </div>

  <p class="muted about">{modes.find(([m]) => m === g.mode)?.[2]}</p>

  <div class="controls">
    {#if g.mode === 'mutate'}
      <span>Mutating <strong>{g.seed?.name ?? '— (use Mutate… on a patch)'}</strong></span>
    {:else if g.mode === 'favourites'}
      <span>{g.favourites.length} hearted patch{g.favourites.length === 1 ? '' : 'es'} as parents</span>
    {/if}
    <label>{wildLabel} <input type="range" min="0" max="1" step="0.05" bind:value={g.wildness} /> {Math.round(g.wildness * 100)}%</label>
    <label>
      How many
      <select bind:value={g.count}>
        {#each [4, 8, 12, 16] as n (n)}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <button class="primary" onclick={() => g.generate()}>Generate</button>
  </div>

  {#if g.candidates.length}
    <div class="grid">
      {#each g.candidates as c (c.key)}
        <div class="card" class:playing={g.playing === c.key} class:kept={c.keptId}>
          <button class="name" onclick={() => g.audition(c)} title={app.synth ? 'Play on the synth and show in the editor' : 'Show in the editor'}>
            ▶ {c.name}
          </button>
          <div class="tags muted">{c.tags.join(' · ') || 'no tags'}</div>
          <div class="how muted">{c.how}</div>
          <div class="actions">
            {#if c.keptId}
              <span class="ok">Kept</span>
            {:else}
              <button class="link" onclick={() => g.keep(c)}>Keep</button>
              <button class="link" onclick={() => g.keep(c, true)}>Keep ♥</button>
            {/if}
            <button class="link" onclick={() => g.mutateCandidate(c)}>Mutate this</button>
          </div>
        </div>
      {/each}
    </div>
    <p class="muted small">Click a name to hear it on the synth; it also loads into the editor, where you can tweak it and save it. Nothing is saved until you keep it.</p>
  {/if}
</div>

<style>
  .gen {
    height: 100%;
    overflow: auto;
    padding: 12px 16px;
  }
  .head {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .modes {
    display: flex;
    gap: 2px;
  }
  .modes button {
    border: none;
    background: none;
  }
  .modes button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .close {
    border: none;
    background: none;
    font-size: 16px;
  }
  .about {
    margin: 6px 0;
    font-size: 13px;
  }
  .controls {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .controls label {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  input[type='range'] {
    accent-color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .card.playing {
    border-color: var(--accent);
    background: var(--select);
  }
  .card.kept {
    box-shadow: inset 3px 0 0 var(--ok);
  }
  .name {
    border: none;
    background: none;
    padding: 0;
    text-align: left;
    font-weight: 600;
  }
  .tags,
  .how {
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 12px;
    font-size: 13px;
    margin-top: 4px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .ok {
    color: var(--ok);
  }
  .small {
    font-size: 12px;
  }
</style>
