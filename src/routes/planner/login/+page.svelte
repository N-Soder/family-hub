<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	// Keep ?next= so you land on the page you opened (e.g. a home-screen shortcut to a list).
	const next = $derived(page.url.searchParams.get('next'));
</script>

<div class="login card">
	<h1>Family Hub</h1>
	<p class="muted">Planner PIN</p>
	<form method="POST" action={next ? `?/login&next=${encodeURIComponent(next)}` : '?/login'}>
		<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" aria-label="PIN" required />
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if !data.pinSet}<p class="error">No PIN set yet. Set ADMIN_PIN in .env and restart.</p>{/if}
		<button>Unlock</button>
	</form>
</div>

<style>
	.login {
		max-width: 320px;
		margin: 10vh auto 0;
		padding: 28px 24px;
		text-align: center;
	}
	input {
		font: inherit;
		font-size: 1.6rem;
		letter-spacing: 0.4em;
		text-align: center;
		width: 100%;
		box-sizing: border-box;
		padding: 12px;
		border-radius: 16px;
		border: 1.5px solid var(--line-strong);
		background: var(--bg);
		color: var(--ink);
		margin-bottom: 12px;
	}
	button {
		width: 100%;
	}
</style>
