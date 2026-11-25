<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, untrack } from 'svelte';
	import Glyph from '$lib/components/Glyph.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();

	// Autosave (ADR-37): a save goes about a second after typing stops, and straight away when a
	// field loses focus, the app is hidden or the page is left. Each save names the version it
	// started from; if someone saved first the server says so (409), their note is shown and what
	// was typed here is kept below it. With no connection the text is kept on this phone and sent
	// when the connection is back.

	type Status = 'saved' | 'waiting' | 'saving' | 'offline' | 'conflict' | 'signedOut' | 'gone' | 'error';
	type Note = { id: number; title: string; body: string; version: number; updatedAt: string };

	let title = $state('');
	let body = $state('');
	let version = 0;
	let server = { title: '', body: '' }; // what the server has
	let status = $state<Status>('saved');
	let message = $state('');
	let edited = $state('');
	let mine = $state<{ title: string; body: string } | null>(null);
	let inflight = false;
	let again = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let shownId: number | null = null;
	let textarea: HTMLTextAreaElement | undefined = $state();
	let heading: HTMLInputElement | undefined = $state();

	const id = $derived(data.note.id);
	const dirty = () => title.trim() !== server.title || body !== server.body;
	const draftKey = () => `fh_note_${id}`;

	function adopt(n: Note) {
		title = n.title;
		body = n.body;
		version = n.version;
		server = { title: n.title, body: n.body };
	}

	// A new note, or someone else's save arriving while nothing is waiting to go from here.
	$effect(() => {
		const n = data.note;
		untrack(() => {
			if (n.id !== shownId) {
				shownId = n.id;
				adopt(n);
				mine = null;
				status = 'saved';
				edited = data.edited;
			} else if (n.version > version && !dirty() && !inflight) {
				adopt(n);
				edited = data.edited;
			}
		});
	});

	// The text box grows with its text, so the page scrolls rather than the box.
	$effect(() => {
		void body;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	});

	function storeDraft() {
		try {
			localStorage.setItem(draftKey(), JSON.stringify({ title, body, version }));
		} catch {
			/* private mode: the text stays on screen only */
		}
	}
	function clearDraft() {
		try {
			localStorage.removeItem(draftKey());
		} catch {
			/* nothing stored */
		}
	}

	async function save(leaving = false) {
		clearTimeout(timer);
		if (!dirty()) {
			if (status === 'waiting' || status === 'offline') status = 'saved';
			clearDraft();
			return;
		}
		if (inflight) {
			again = true;
			return;
		}
		if (!navigator.onLine) {
			storeDraft();
			status = 'offline';
			return;
		}
		inflight = true;
		status = 'saving';
		const sent = { title: title.trim(), body, version };
		try {
			const res = await fetch(`/planner/notes/${id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(sent),
				keepalive: leaving
			});
			const out = await res.json().catch(() => ({}));
			if (res.ok) {
				version = out.note.version;
				server = { title: out.note.title, body: out.note.body };
				edited = 'Just now';
				if (dirty()) storeDraft();
				else clearDraft();
				status = dirty() ? 'waiting' : 'saved';
			} else if (res.status === 409) {
				mine = { title: title.trim(), body };
				adopt(out.note);
				clearDraft();
				status = 'conflict';
				edited = 'Just now';
			} else if (res.status === 401) {
				storeDraft();
				status = 'signedOut';
			} else if (res.status === 404) {
				clearDraft();
				status = 'gone';
			} else {
				storeDraft();
				status = 'error';
				message = out.error ?? 'Could not save.';
			}
		} catch {
			storeDraft();
			status = 'offline';
		} finally {
			inflight = false;
		}
		if (again) {
			again = false;
			void save();
		}
	}

	function typed() {
		if (status === 'gone') return;
		if (status !== 'conflict') status = 'waiting';
		clearTimeout(timer);
		timer = setTimeout(save, 900);
	}

	/** Put what was typed here back, over the other person's save. */
	function keepMine() {
		if (!mine) return;
		title = mine.title;
		body = mine.body;
		mine = null;
		void save();
	}

	/** A new note left with nothing in it is not kept. */
	const untouched = () => !title.trim() && !body.trim() && !server.title && !server.body.trim();
	async function dropIfEmpty() {
		if (!untouched()) return;
		clearDraft();
		await fetch(`/planner/notes/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
	}

	// Leaving inside the app waits (up to 3 s) for the last save or the empty-note delete, so the
	// Notes list it lands on is up to date. Closing or reloading the app can't wait: those go with
	// keepalive and the draft stays on the phone if they fail.
	let continuing = false;
	beforeNavigate((nav) => {
		if (continuing || nav.to?.url.pathname === page.url.pathname) return;
		const pending = dirty() || untouched();
		if (!pending) return;
		if (nav.type === 'leave' || !nav.to) {
			if (dirty()) void save(true);
			else void dropIfEmpty();
			return;
		}
		nav.cancel();
		const to = nav.to.url;
		const delta = nav.type === 'popstate' ? nav.delta : undefined;
		const work = dirty() ? save(true) : dropIfEmpty();
		void Promise.race([work, new Promise((r) => setTimeout(r, 3000))]).then(() => {
			continuing = true;
			if (delta) history.go(delta);
			else void goto(to, { invalidateAll: true });
		});
	});

	onMount(() => {
		// Text kept on this phone from an earlier visit (no connection, or signed out) goes now.
		try {
			const raw = localStorage.getItem(draftKey());
			const d = raw ? JSON.parse(raw) : null;
			if (d && typeof d.title === 'string' && typeof d.body === 'string' && typeof d.version === 'number') {
				title = d.title;
				body = d.body;
				version = d.version;
				void save();
			}
		} catch {
			/* no draft */
		}
		if (page.url.searchParams.has('new')) void tick().then(() => heading?.focus());

		const hidden = () => {
			if (document.visibilityState === 'hidden') {
				if (dirty()) void save(true);
			}
		};
		const online = () => void save();
		const es = new EventSource('/api/events');
		es.addEventListener('change', (e) => {
			const ev = JSON.parse(e.data);
			if (ev.reason === 'note' && ev.noteId === id && !dirty() && !inflight) invalidateAll();
		});
		document.addEventListener('visibilitychange', hidden);
		addEventListener('online', online);
		return () => {
			es.close();
			document.removeEventListener('visibilitychange', hidden);
			removeEventListener('online', online);
		};
	});

	const statusText = $derived(
		{
			saved: `Saved · edited ${edited.toLowerCase()}`,
			waiting: 'Editing…',
			saving: 'Saving…',
			offline: 'No connection. Kept on this phone; it saves when you are back online.',
			conflict: 'Someone else changed this note while you were typing. Theirs is shown; yours is below.',
			signedOut: 'Signed out. Kept on this phone; sign in again to save it.',
			gone: 'This note has been deleted.',
			error: message
		}[status]
	);
	const alert = $derived(['offline', 'conflict', 'signedOut', 'gone', 'error'].includes(status));
</script>

<BackLink href="/planner/notes" label="Notes" />

<p class="status" class:alert role="status" aria-live="polite">{statusText}</p>

<div class="card editor">
	<input
		class="heading"
		bind:this={heading}
		bind:value={title}
		oninput={typed}
		onblur={() => save()}
		placeholder="Heading"
		aria-label="Heading"
		maxlength="80"
		autocomplete="off"
		autocapitalize="sentences"
		disabled={status === 'gone'}
	/>
	<textarea
		bind:this={textarea}
		bind:value={body}
		oninput={typed}
		onblur={() => save()}
		placeholder="Write your note…"
		aria-label="Note"
		maxlength="20000"
		rows="8"
		autocapitalize="sentences"
		disabled={status === 'gone'}
	></textarea>
</div>

{#if mine}
	<div class="card mine">
		<strong>What you typed</strong>
		<textarea readonly rows="4" aria-label="What you typed">{(mine.title ? mine.title + '\n\n' : '') + mine.body}</textarea>
		<div class="row">
			<button onclick={keepMine}>Use mine instead</button>
			<button class="ghost" onclick={() => ((mine = null), (status = 'saved'))}>Keep theirs</button>
		</div>
	</div>
{/if}

{#if status !== 'gone'}
	<details class="card" open={!!form?.confirmError}>
		<summary>Delete note</summary>
		<form method="POST" action="?/remove">
			<label class="confirm"><input type="checkbox" name="confirm" /> Yes, delete it for everyone</label>
			{#if form?.confirmError}<p class="error">{form.confirmError}</p>{/if}
			<button class="ghost danger"><Glyph name="trash" size={18} /> Delete “{title.trim() || 'Untitled'}”</button>
		</form>
	</details>
{/if}

<style>
	.status {
		min-height: 1.4em;
		margin: 0 0 10px;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.status.alert {
		color: var(--warn);
		font-weight: 600;
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.editor input,
	.editor textarea,
	.mine textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		color: var(--ink);
		background: none;
		border: 0;
		padding: 4px 2px;
	}
	.heading {
		font-size: 1.5rem !important;
		font-weight: 700;
		border-bottom: 1px solid var(--line) !important;
		padding-bottom: 10px !important;
	}
	.editor textarea {
		font-size: 17px; /* 16px+ stops iOS zooming on focus */
		line-height: 1.5;
		min-height: 12em;
		resize: none;
		overflow: hidden;
	}
	.editor input:focus-visible,
	.editor textarea:focus-visible {
		outline: none;
	}
	.mine {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mine textarea {
		font-size: 16px;
		border: 1.5px solid var(--line-strong);
		border-radius: 14px;
		padding: 10px 12px;
		resize: vertical;
	}
	.mine .row {
		margin: 0;
	}
	details summary {
		font-weight: 600;
	}
	details form {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.confirm {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.danger {
		color: var(--warn);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
