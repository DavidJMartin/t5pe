<script lang="ts">
  import { onMount } from 'svelte';
  import { CATEGORIES } from '../core/library/category';
  import { LibraryFolder } from '../storage/folder';
  import BanksPanel from './BanksPanel.svelte';
  import Editor from './Editor.svelte';
  import GeneratePanel from './GeneratePanel.svelte';
  import PatchDetail from './PatchDetail.svelte';
  import PatchList from './PatchList.svelte';
  import { AppState, type Origin } from './state.svelte';

  const app = new AppState();
  let fileInput: HTMLInputElement;
  let shell: HTMLDivElement;

  /** Dragging the divider between the library and the editor. */
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const rect = shell.getBoundingClientRect();
    const move = (ev: PointerEvent) => app.setEditorSplit((rect.bottom - ev.clientY) / rect.height);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
  let dragging = $state(false);

  onMount(() => {
    void app.init();
  });

  const counts = $derived.by(() => {
    const live = app.rows.filter((r) => !r.binnedAt && !r.supersededBy);
    const byCategory = new Map<string, number>();
    const byTag = new Map<string, number>();
    for (const r of live) {
      byCategory.set(r.category ?? 'none', (byCategory.get(r.category ?? 'none') ?? 0) + 1);
      for (const t of r.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);
    }
    return {
      live: live.length,
      hearted: live.filter((r) => r.hearted).length,
      bin: app.rows.filter((r) => r.binnedAt).length,
      onSynth: live.filter((r) => r.onSynth).length,
      byCategory,
      byTag: [...byTag].sort((a, b) => b[1] - a[1]),
    };
  });

  const origins: [Origin, string][] = [
    ['all', 'All'],
    ['user', 'My banks'],
    ['factory', 'Factory banks'],
    ['files', 'Files'],
    ['generated', 'Generated'],
  ];

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) void app.importFiles(e.dataTransfer.files);
  }

  function folderLabel(): string {
    const s = app.folderStatus;
    switch (s.state) {
      case 'unsupported':
        return 'Library folders need Chrome or Edge';
      case 'none':
        return 'No library folder';
      case 'needs-permission':
        return `Library folder "${s.folder}": needs permission`;
      case 'syncing':
        return `Library folder "${s.folder}": saving…`;
      case 'ok':
        return `Library folder "${s.folder}": saved ${new Date(s.at).toLocaleTimeString()}`;
      case 'error':
        return `Library folder "${s.folder}": failed (${s.message})`;
    }
  }
</script>

<svelte:window
  ondragover={(e) => {
    // Only files trigger the import overlay; patch and slot drags belong to the Banks panel.
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false;
  }}
  ondrop={onDrop}
/>

<div
  class="shell"
  class:with-editor={app.editorOpen || app.banksOpen || app.generateOpen}
  bind:this={shell}
  style:--library-rows={`${1 - app.editorSplit}fr`}
  style:--editor-rows={`${app.editorSplit}fr`}
>
  <div class="top">
  <header>
    <h1>Take 5 Library</h1>
    <button class="editor-toggle" class:active={app.editorOpen} aria-pressed={app.editorOpen} onclick={() => app.setEditorOpen(!app.editorOpen)}>
      {app.editorOpen ? '▾' : '▸'} Editor
    </button>
    <button class="editor-toggle" class:active={app.generateOpen} aria-pressed={app.generateOpen} onclick={() => app.setGenerateOpen(!app.generateOpen)}>
      {app.generateOpen ? '▾' : '▸'} Generate
    </button>
    <button onclick={() => app.newPatch()} title="Start a new sound from the Init patch, on the synth and in the editor">+ New patch</button>
    <button class="editor-toggle" class:active={app.banksOpen} aria-pressed={app.banksOpen} onclick={() => app.setBanksOpen(!app.banksOpen)}>
      {app.banksOpen ? '▾' : '▸'} Banks{app.changes.length ? ` (${app.changes.length})` : ''}
    </button>

    <div class="group">
      {#if app.synth}
        <span class="pill ok" title="Connected over USB">● Take 5 connected</span>
        <label class="toggle" title="Send each selected patch to the synth's edit buffer">
          <input type="checkbox" bind:checked={app.auditionOn} disabled={!!app.reading} /> Audition
        </label>
        {#if app.reading}
          <progress max={app.reading.total} value={app.reading.done}></progress>
          <span class="muted">{app.reading.done}/{app.reading.total}</span>
          <button onclick={() => app.cancelRead()}>Stop</button>
        {:else}
          <button
            onclick={() => {
              if (confirm('Read all 512 programs from the synth? It takes about 13 minutes and never changes anything on the synth.')) void app.readSynth();
            }}>Read synth</button
          >
        {/if}
      {:else}
        <button class="primary" onclick={() => app.connect()} disabled={app.connecting}>
          {app.connecting ? 'Connecting…' : 'Connect synth'}
        </button>
      {/if}
    </div>

    <div class="group">
      <button onclick={() => fileInput.click()}>Import .syx…</button>
      <input bind:this={fileInput} type="file" accept=".syx" multiple hidden onchange={(e) => {
        const input = e.currentTarget;
        if (input.files) void app.importFiles(input.files).then(() => (input.value = ''));
      }} />
    </div>

    <div class="group folder-status" class:warn={app.folderStatus.state !== 'ok' && app.folderStatus.state !== 'syncing'}>
      <span>{folderLabel()}</span>
      {#if LibraryFolder.supported && app.folderStatus.state !== 'none'}
        <button onclick={() => app.folder.choose()}>Change…</button>
      {/if}
    </div>
  </header>

  {#if app.folderStatus.state === 'needs-permission'}
    <div class="banner">
      <strong>Reconnect your library folder.</strong> Browsers ask again after a restart. Until then, changes are only in this browser.
      <button class="primary" onclick={() => app.folder.reconnect()}>Reconnect "{app.folderStatus.folder}"</button>
    </div>
  {:else if app.folderStatus.state === 'none' && app.rows.length > 0}
    <div class="banner">
      <strong>Your library is only in this browser.</strong> Open a library folder so it's saved, and so any copy of this app
      (another port, the hosted version) can open the same library.
      <button class="primary" onclick={() => app.folder.choose()}>Open library folder…</button>
    </div>
  {/if}
  {#if app.synthError}
    <div class="banner error">{app.synthError} <button onclick={() => (app.synthError = null)}>Dismiss</button></div>
  {/if}
  {#if app.synth && !app.auditionOn && !app.reading}
    <div class="banner">
      <strong>Audition is off.</strong> When on, every patch you select is sent to the synth's edit buffer. That replaces the
      current sound, so any unsaved knob changes on the synth are lost. Nothing is written to the synth's memory.
      <button class="primary" onclick={() => (app.auditionOn = true)}>Turn on audition</button>
    </div>
  {/if}
  {#if app.notice}
    <div class="banner" class:error={app.notice.kind === 'error'}>
      {app.notice.text} <button onclick={() => (app.notice = null)}>Dismiss</button>
    </div>
  {/if}
  </div>

  <aside>
    <input type="search" placeholder="Search names or slot (A-07)" bind:value={app.query} />

    <nav>
      <button class:active={app.view === 'library' && !app.heartedOnly} onclick={() => ((app.view = 'library'), (app.heartedOnly = false))}>
        Library <span>{counts.live}</span>
      </button>
      <button class:active={app.view === 'library' && app.heartedOnly} onclick={() => ((app.view = 'library'), (app.heartedOnly = true))}>
        ♥ Favourites <span>{counts.hearted}</span>
      </button>
      <button class:active={app.view === 'bin'} onclick={() => ((app.view = 'bin'), (app.heartedOnly = false))}>
        Bin <span>{counts.bin}</span>
      </button>
    </nav>

    <h2>Origin</h2>
    <div class="chips">
      {#each origins as [value, label] (value)}
        <button class:active={app.origin === value} onclick={() => (app.origin = value)}>{label}</button>
      {/each}
    </div>

    <h2>Tags <span class="muted">(from the sound; pick several to narrow)</span></h2>
    <div class="chips">
      {#each counts.byTag as [t, n] (t)}
        <button class:active={app.tagFilter.includes(t)} onclick={() => (app.tagFilter = app.tagFilter.includes(t) ? app.tagFilter.filter((x) => x !== t) : [...app.tagFilter, t])}>{t} <span>{n}</span></button>
      {/each}
      {#if app.tagFilter.length}<button onclick={() => (app.tagFilter = [])}>Clear</button>{/if}
    </div>

    <h2>Category <span class="muted">(guessed from names)</span></h2>
    <div class="chips">
      <button class:active={app.category === 'all'} onclick={() => (app.category = 'all')}>All</button>
      {#each CATEGORIES as c (c)}
        {#if counts.byCategory.get(c)}
          <button class:active={app.category === c} onclick={() => (app.category = c)}>{c} <span>{counts.byCategory.get(c)}</span></button>
        {/if}
      {/each}
      <button class:active={app.category === 'none'} onclick={() => (app.category = 'none')}>
        Unsorted <span>{counts.byCategory.get('none') ?? 0}</span>
      </button>
    </div>

    <h2>Sort</h2>
    <select bind:value={app.sort}>
      <option value="slot">By synth slot</option>
      <option value="name">By name</option>
      <option value="added">Recently added</option>
    </select>

    {#if counts.live}
      <p class="muted small">{counts.onSynth} of {counts.live} patches are on the synth as of the latest read.</p>
    {/if}
  </aside>

  <main>
    {#if !app.loaded}
      <p class="empty muted">Loading library…</p>
    {:else if app.rows.length === 0}
      <div class="empty">
        <h2>Open your library</h2>
        {#if LibraryFolder.supported}
          <p>If you already have a library folder, open it and everything in it loads: patches, hearts, renames and history.</p>
          <p><button class="primary" onclick={() => app.folder.choose()}>Open library folder…</button></p>
        {/if}
        <p class="muted">
          Starting fresh? Open an empty folder (e.g. in iCloud Drive), then drop a <code>.syx</code> file anywhere on this
          page, such as the synth backup in <code>backups/</code>, or connect the synth and choose <em>Read synth</em>.
        </p>
      </div>
    {:else}
      <PatchList {app} />
    {/if}
  </main>

  <section class="detail">
    {#if app.selected}
      <PatchDetail {app} row={app.selected} />
    {:else}
      <p class="muted empty">Select a patch. ↑/↓ moves through the list and auditions; H hearts.</p>
    {/if}
  </section>

  {#if app.editorOpen || app.banksOpen || app.generateOpen}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the editor"
      onpointerdown={startResize}
    ></div>
    <div class="editor-area">
      {#if app.banksOpen}<BanksPanel {app} />{:else if app.generateOpen}<GeneratePanel {app} />{:else}<Editor {app} />{/if}
    </div>
  {/if}

  {#if dragging}
    <div class="drop">Drop .syx files to import</div>
  {/if}
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 340px;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'top top top'
      'aside main detail';
    height: 100%;
  }
  .shell.with-editor {
    grid-template-rows: auto minmax(120px, var(--library-rows)) 8px minmax(160px, var(--editor-rows));
    grid-template-areas:
      'top top top'
      'aside main detail'
      'divider divider divider'
      'editor editor editor';
  }
  .divider {
    grid-area: divider;
    cursor: row-resize;
    background: var(--line);
    border-top: 3px solid var(--bg);
    border-bottom: 3px solid var(--bg);
    touch-action: none;
  }
  .divider:hover {
    background: var(--accent);
  }
  .editor-area {
    grid-area: editor;
    min-height: 0;
    background: var(--bg);
  }
  .editor-toggle.active {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }
  .top {
    grid-area: top;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  h1 {
    font-size: 16px;
    margin: 0;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .folder-status {
    margin-left: auto;
    font-size: 13px;
  }
  .folder-status.warn span {
    color: var(--warn);
  }
  .pill.ok {
    color: var(--ok);
    font-weight: 500;
  }
  .toggle {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .banner {
    padding: 8px 16px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--line);
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .banner.error {
    color: var(--error);
  }
  aside {
    grid-area: aside;
    padding: 12px;
    border-right: 1px solid var(--line);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  aside h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 10px 0 0;
    color: var(--muted);
  }
  aside h2 .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: normal;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  nav button {
    border: none;
    background: none;
    text-align: left;
    display: flex;
    justify-content: space-between;
  }
  nav button.active,
  .chips button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips button {
    padding: 2px 8px;
    font-size: 13px;
  }
  nav span,
  .chips span {
    color: var(--muted);
    font-size: 12px;
  }
  .small {
    font-size: 12px;
  }
  main {
    grid-area: main;
    overflow: auto;
    min-height: 0;
  }
  .detail {
    grid-area: detail;
    border-left: 1px solid var(--line);
    overflow: auto;
    background: var(--panel);
  }
  .empty {
    padding: 24px;
    max-width: 560px;
  }
  .drop {
    position: fixed;
    inset: 12px;
    border: 3px dashed var(--accent);
    border-radius: 16px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    display: grid;
    place-items: center;
    font-size: 20px;
    pointer-events: none;
  }
  @media (max-width: 900px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
      grid-template-areas: none;
      height: auto;
    }
    .top,
    aside,
    main,
    .detail {
      grid-area: auto;
    }
    aside,
    .detail {
      border: none;
    }
    .shell.with-editor {
      grid-template-rows: auto;
    }
    .divider {
      display: none;
    }
    .editor-area {
      grid-area: auto;
      height: 75vh;
    }
  }
</style>
