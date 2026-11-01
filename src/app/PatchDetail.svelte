<script lang="ts">
  import { sanitizeName } from '../core/patch/name';
  import { currentVersion, versionHistory, type HistoryEntry } from '../core/library/history';
  import { slotLabel } from '../core/library/slots';
  import { editBufferDump } from '../core/sysex/messages';
  import { patchFileName } from '../storage/folder';
  import type { AppState, Row } from './state.svelte';

  let { app, row }: { app: AppState; row: Row } = $props();

  let draft = $state('');
  $effect(() => {
    draft = row.name;
  });

  // Random name idea (design.md §3.8); "Another" rolls the next one. Resets when another patch is selected.
  let attempt = $state(0);
  $effect(() => {
    void row.id;
    attempt = 0;
  });
  const idea = $derived(app.nameIdea(row, attempt));

  const byId = $derived(new Map(app.rows.map((r) => [r.id, r])));
  const history = $derived(versionHistory(row.id, app.rows, app.rows.flatMap((r) => r.provenance)));
  const currentId = $derived(currentVersion(row.id, app.rows));
  const current = $derived(byId.get(currentId));
  /** Patches this one was made from with "save as new" (not earlier versions of itself). */
  const madeFrom = $derived(
    row.parentIds.filter((id) => !history.some((h) => h.patchId === id)).map((id) => byId.get(id)).filter((r) => r !== undefined),
  );
  const viewingSavedAt = $derived(history.find((h) => h.patchId === row.id)?.at ?? row.createdAt);

  function describe(h: HistoryEntry): string {
    switch (h.action) {
      case 'original':
        return h.source.startsWith('edited from') ? `Saved as new (${h.source})` : `Original, from ${h.source}`;
      case 'update':
        return 'Updated';
      case 'rename':
        return 'Renamed';
      case 'restore':
        return 'Restored an earlier version';
    }
  }

  const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const sameSound = $derived(app.rows.filter((r) => r.soundHash === row.soundHash && r.id !== row.id));
  const places = $derived([...row.provenance].sort((a, b) => b.at - a.at));

  async function commitName() {
    const clean = sanitizeName(draft);
    if (!clean || clean === row.name) {
      draft = row.name;
      return;
    }
    await app.rename(row.id, clean);
    app.flash(`Renamed to "${clean}". The original is kept; see "Renamed from" in its history.`);
  }

  function download() {
    const blob = new Blob([editBufferDump(row.data) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = patchFileName(row.id, row.name);
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<div class="detail">
  <div class="title">
    <button
      class="heart"
      class:on={row.hearted}
      aria-label={row.hearted ? 'Remove from favourites' : 'Add to favourites'}
      onclick={() => app.library.setHearted(row.id, !row.hearted)}>{row.hearted ? '♥' : '♡'}</button
    >
    <input
      class="name"
      maxlength="20"
      bind:value={draft}
      aria-label="Patch name"
      onkeydown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          draft = row.name;
          e.currentTarget.blur();
        }
      }}
      onblur={commitName}
    />
  </div>
  <p class="idea">
    <span class="muted">Name idea:</span> <strong>{idea}</strong>
    <button class="link" onclick={() => app.rename(row.id, idea)}>Use</button>
    <button class="link" onclick={() => attempt++}>Another</button>
  </p>
  <p class="muted small">Up to 20 characters. Renaming keeps the previous version in its history.</p>

  <div class="actions">
    <button class="primary" disabled={!app.synth || !!app.reading} onclick={() => app.audition(row.id, true)}
      title={app.synth ? 'Send to the synth edit buffer' : 'Connect the synth first'}>▶ Audition</button
    >
    <button onclick={() => app.edit(row.id)}>Open in editor</button>
    <button onclick={() => app.generator.mutateRow(row.id)} title="Generate variations of this patch">Mutate…</button>
    <button onclick={download}>Download .syx</button>
    {#if row.binnedAt}
      <button onclick={() => app.library.restore(row.id)}>Restore from bin</button>
    {:else}
      <button onclick={() => app.library.bin(row.id)}>Move to bin</button>
    {/if}
  </div>

  <dl>
    <dt>Tags</dt>
    <dd>
      {#each row.tags as t (t)}
        <button class="tag" class:on={app.tagFilter.includes(t)} onclick={() => (app.tagFilter = app.tagFilter.includes(t) ? app.tagFilter.filter((x) => x !== t) : [...app.tagFilter, t])}>{t}</button>
      {:else}
        <span class="muted">none</span>
      {/each}
      <span class="muted small">(from the sound's settings)</span>
    </dd>
    <dt>On the synth</dt>
    <dd>
      {#if row.onSynth}
        {row.location}
      {:else if row.editedVersion}
        Updated version of the patch in {row.location.replace(' · edited', '')}. Not written to the synth's memory.
      {:else if row.location}
        <span class="warn">Not in the latest read ({row.location})</span>
      {:else}
        Not seen on the synth
      {/if}
    </dd>
  </dl>

  {#if row.supersededBy && current}
    <div class="note">
      <p>You're looking at an earlier version (saved {when(viewingSavedAt)}). The current version is "{current.name}".</p>
      <button class="primary" onclick={() => app.restoreVersion(row.id, viewingSavedAt)}>Restore this version</button>
      <button onclick={() => app.select(current.id, false)}>Go to current</button>
    </div>
  {/if}

  <h3>History</h3>
  <ol class="history">
    {#each history as h, i (`${h.patchId}-${h.at}-${i}`)}
      <li class:viewing={h.patchId === row.id} class:current={h.current}>
        <div class="line">
          <span class="when">{when(h.at)}</span>
          {#if h.current}<span class="badge">current</span>{/if}
        </div>
        <div class="line">
          <span>{describe(h)}: <strong>{byId.get(h.patchId)?.name ?? '?'}</strong></span>
        </div>
        {#if h.patchId !== row.id || h.patchId !== currentId}
          <div class="line buttons">
            {#if h.patchId !== row.id}<button class="link" onclick={() => app.select(h.patchId)}>View</button>{/if}
            {#if h.patchId !== currentId}<button class="link" onclick={() => app.restoreVersion(h.patchId, h.at)}>Restore</button>{/if}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
  {#if history.length === 1}
    <p class="muted small">Every update, rename and restore adds an entry here. Nothing is ever lost.</p>
  {/if}

  {#if madeFrom.length}
    <h3>Made from</h3>
    <ul>
      {#each madeFrom as p (p.id)}
        <li><button class="link" onclick={() => app.select(p.id, false)}>{p.name}</button></li>
      {/each}
    </ul>
  {/if}
  {#if sameSound.length}
    <h3>Same sound, other names</h3>
    <ul>
      {#each sameSound as p (p.id)}
        <li><button class="link" onclick={() => app.select(p.id, false)}>{p.name}</button></li>
      {/each}
    </ul>
  {/if}

  <h3>Seen in ({places.length})</h3>
  <ul class="places">
    {#each places as p (p.id)}
      <li>
        <span>{p.source}</span>
        {#if p.bank !== undefined && p.prog !== undefined}<span class="mono">{slotLabel(p.bank, p.prog)}</span>{/if}
        <span class="muted small">{new Date(p.at).toLocaleDateString()}</span>
      </li>
    {/each}
  </ul>

  <h3>Identity</h3>
  <p class="mono muted id">{row.id}</p>
</div>

<style>
  .detail {
    padding: 16px;
  }
  .title {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .name {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
    border-color: transparent;
    background: transparent;
    padding: 4px 6px;
  }
  .name:hover,
  .name:focus {
    border-color: var(--line);
    background: var(--bg);
  }
  .heart {
    border: none;
    background: none;
    font-size: 22px;
    padding: 0 4px;
    color: var(--muted);
  }
  .heart.on {
    color: var(--heart);
  }
  .small {
    font-size: 12px;
    margin: 2px 0 12px;
  }
  .idea {
    font-size: 13px;
    margin: 6px 0 0;
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 16px 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .warn {
    color: var(--warn);
  }
  .tag {
    padding: 0 8px;
    margin: 0 4px 4px 0;
    font-size: 12px;
    border-radius: 999px;
  }
  .tag.on {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 16px 0 6px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .places li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 3px 0;
    border-bottom: 1px solid var(--line);
  }
  .places li span:first-child {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .note {
    background: var(--accent-soft);
    padding: 8px;
    border-radius: var(--radius);
    margin-top: 12px;
  }
  .note p {
    margin: 0 0 8px;
  }
  .history {
    list-style: none;
    padding: 0;
    margin: 0;
    border-left: 2px solid var(--line);
  }
  .history li {
    position: relative;
    padding: 4px 0 8px 12px;
  }
  .history li::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 9px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--panel);
    border: 2px solid var(--line);
  }
  .history li.current::before {
    background: var(--accent);
    border-color: var(--accent);
  }
  .history li.viewing {
    background: var(--select);
    border-radius: 0 6px 6px 0;
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .when {
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
  .buttons {
    gap: 12px;
    font-size: 13px;
  }
  .id {
    overflow-wrap: anywhere;
  }
</style>
