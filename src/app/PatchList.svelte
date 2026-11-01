<script lang="ts">
  import type { AppState } from './state.svelte';

  let { app }: { app: AppState } = $props();

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      app.step(1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      app.step(-1);
    } else if (e.key === 'h' && app.selected) {
      void app.library.setHearted(app.selected.id, !app.selected.hearted);
    } else if (e.key === ' ' && app.selected) {
      e.preventDefault();
      app.audition(app.selected.id, true);
    }
  }

  $effect(() => {
    const id = app.selectedId;
    if (id) document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'nearest' });
  });
</script>

<svelte:window onkeydown={onKey} />

{#if app.visible.length === 0}
  <p class="none muted">No patches match.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="heart" aria-label="Favourite"></th>
        <th>Name</th>
        <th>Slot</th>
        <th>Tags</th>
        <th>Seen in</th>
      </tr>
    </thead>
    <tbody>
      {#each app.visible as row (row.id)}
        <tr
          id="row-{row.id}"
          class:selected={row.id === app.selectedId}
          class:gone={!row.onSynth && row.location && !row.editedVersion}
          class:edited={row.editedVersion}
          draggable="true"
          ondragstart={(e) => {
            e.dataTransfer?.setData('application/x-take5-patch', row.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
          }}
          onclick={() => app.select(row.id)}
        >
          <td class="heart">
            <button
              class:on={row.hearted}
              aria-label={row.hearted ? 'Remove from favourites' : 'Add to favourites'}
              onclick={(e) => {
                e.stopPropagation();
                void app.library.setHearted(row.id, !row.hearted);
              }}>{row.hearted ? '♥' : '♡'}</button
            >
          </td>
          <td class="name">
            {row.name || '(no name)'}
            {#if row.id === app.lastAuditioned && app.auditionOn}<span class="playing" title="On the synth now">◀ playing</span>{/if}
          </td>
          <td class="slot mono">{row.location}</td>
          <td class="muted tags">{row.tags.join(' · ')}</td>
          <td class="muted sources">{row.provenance.length === 1 ? row.provenance[0].source : `${row.provenance.length} places`}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--panel-2);
    text-align: left;
    font-weight: 500;
    font-size: 12px;
    color: var(--muted);
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--panel-2);
  }
  tr.selected,
  tr.selected:hover {
    background: var(--select);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  tr.gone .slot {
    color: var(--warn);
  }
  tr.edited .slot {
    color: var(--accent);
  }
  .heart {
    width: 32px;
    padding: 0 0 0 6px;
  }
  .heart button {
    border: none;
    background: none;
    padding: 2px 4px;
    font-size: 16px;
    color: var(--muted);
  }
  .heart button.on {
    color: var(--heart);
  }
  .name {
    font-weight: 500;
  }
  .playing {
    margin-left: 8px;
    font-size: 11px;
    font-weight: normal;
    color: var(--accent);
  }
  .tags {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
  }
  .sources {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .none {
    padding: 24px;
  }
</style>
