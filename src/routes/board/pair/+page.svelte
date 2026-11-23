<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<main>
	<h1>Pair this screen</h1>
	<p>On a phone, open <strong>Planner → Settings → Board</strong> and tap <strong>Pair a screen</strong>. Type the code here.</p>
	<form method="POST" use:enhance>
		<label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required /></label>
		<label>Name this screen <input name="name" placeholder="Kitchen TV" maxlength="40" /></label>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<button>Pair</button>
	</form>
	{#if data.adult}<p class="muted">You are signed in as an adult, so <a href="/board">the Board</a> opens without pairing on this device.</p>{/if}
</main>

<style>
	main {
		max-width: 28rem;
		margin: 10vh auto;
		padding: 0 16px;
	}
	form {
		display: grid;
		gap: 14px;
		margin-top: 1rem;
	}
	label {
		display: grid;
		gap: 4px;
		font-weight: 600;
	}
	input {
		font: 17px var(--sans);
		padding: 12px;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--card);
		color: var(--ink);
	}
	input[name='code'] {
		font-size: 2rem;
		letter-spacing: 0.3em;
		text-align: center;
	}
	button {
		font: 600 17px var(--sans);
		padding: 12px;
		border: 0;
		border-radius: 10px;
		background: var(--accent);
		color: var(--on-accent);
	}
	.error {
		color: var(--warn);
		margin: 0;
	}
	.muted {
		color: var(--muted);
	}
</style>
