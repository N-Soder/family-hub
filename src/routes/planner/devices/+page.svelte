<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<h1>Devices</h1>
{#if form?.token}
	<div class="card shown-once" role="status">
		<strong>Token for {form.for}</strong> — shown once, stored hashed.
		<code>{form.token}</code>
	</div>
{/if}
{#if form?.buttonMap}
	<div class="card shown-once" role="status">
		<strong>Side buttons for {form.for}</strong>
		<ol class="small">
			<li>In Tesserae: Settings → Devices → {form.for}.</li>
			<li>Untick <em>Touch input</em> (the wall has no touch now).</li>
			<li>Paste this into <em>Button map</em> and press Save.</li>
		</ol>
		<pre>{form.buttonMap}</pre>
		<p class="muted small">It holds the wall’s token: after “Rotate token” or “Set up on Tesserae”, copy it again.</p>
	</div>
{/if}
{#if form?.notice}<p role="status">{form.notice}</p>{/if}
{#if form?.errors}<p class="error" role="alert">{Object.values(form.errors)[0]}</p>{/if}

<div class="card">
	{#each data.devices as d (d.id)}
		<div class="dev">
			<div>
				<strong>{d.name}</strong> <code>{d.id}</code>
				<div class="muted small">
					{d.settings.tesseraePageId ? `Tesserae page ${d.settings.tesseraePageId}` : d.settings.sim ? 'simulator' : 'not on Tesserae'}
					· last seen {d.lastSeen ? new Date(d.lastSeen).toLocaleString('en-AU') : 'never'}
				</div>
			</div>
			<form method="POST" use:enhance={keep()} class="row">
				<input type="hidden" name="id" value={d.id} />
				{#if data.tesserae}<button class="ghost" formaction="?/tesserae">Set up on Tesserae</button>{/if}
				<button class="ghost" formaction="?/rotate">Rotate token</button>
				{#if data.tesserae && d.settings.tesseraePageId && !d.settings.sim}<button class="ghost" formaction="?/buttons">Side buttons</button>{/if}
				{#if d.removable}
					<button class="ghost" formaction="?/remove" onclick={(e) => confirm(`Remove ${d.name}? Its token stops working.`) || e.preventDefault()}>Remove</button>
				{/if}
			</form>
		</div>
	{/each}
</div>

<details class="card">
	<summary><strong>Add device</strong></summary>
	<p class="muted small">Use the device id Tesserae shows under Settings → Devices, then “Set up on Tesserae”.</p>
	<form method="POST" action="?/add" use:enhance={keep(['name', 'shortLabel', 'id'])}>
		<label class="field">Device id <input name="id" required pattern="[a-z][a-z0-9_\-]{'{'}1,31{'}'}" /></label>
		<label class="field">Name <input name="name" required maxlength="60" /></label>
		<button>Add device</button>
	</form>
</details>

<h2>Tesserae</h2>
<div class="card">
	{#if !data.tesserae}
		<p class="muted">TESSERAE_URL is not set; the wall is not connected. The simulator’s direct mode still works.</p>
	{:else}
		<div class="spread">
			<span>Setup: <strong>{data.bootstrap.state}</strong>{data.bootstrap.error ? ` — ${data.bootstrap.error}` : ''}</span>
			<form method="POST" action="?/bootstrap" use:enhance={keep()}><button class="ghost">Run setup again</button></form>
		</div>
		{#if data.bootstrap.steps.length}<ul class="small muted">{#each data.bootstrap.steps as s, i (i)}<li>{s}</li>{/each}</ul>{/if}
		{#if data.pushes.length}
			<h3>Recent repaints</h3>
			<ul class="small">{#each data.pushes as p, i (i)}<li>{p.deviceId}: {p.mode} → {p.status}</li>{/each}</ul>
		{/if}
	{/if}
</div>

<style>
	pre {
		white-space: pre-wrap;
		word-break: break-all;
		font-size: 0.8rem;
		user-select: all;
	}
	.dev {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		padding: 10px 0;
		border-top: 1px solid var(--line);
	}
	.dev:first-child {
		border-top: none;
	}
	.small {
		font-size: 0.85rem;
	}
	.shown-once code {
		display: block;
		margin-top: 8px;
		word-break: break-all;
		font-size: 0.95rem;
	}
	summary {
		cursor: pointer;
	}
	h3 {
		font-size: 1rem;
		margin: 12px 0 4px;
	}
</style>
