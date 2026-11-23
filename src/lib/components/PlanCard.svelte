<script lang="ts">
	// A baby's day plan on the Routines tab (SPEC §12.3): the timetable, ticked from the phone, and
	// timer steps (a nap): start, a live counter while it runs, stop ("Awake"), with times that can
	// be set in the past ("went down 10 min ago") and a short Undo after stopping.
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import { onMount } from 'svelte';
	import Glyph from './Glyph.svelte';

	type Row = {
		id: number;
		title: string;
		icon: string | null;
		completedAt: string | null;
		minutes: number | null;
		time: string | null;
		estimate: boolean;
		done: boolean;
		next: boolean;
		timer: boolean;
		running: boolean;
		endMinutes: number | null;
		endTime: string | null;
		durationMin: number | null;
		usualMin: number | null;
		rule: string | null;
		waiting: string | null;
	};
	type Plan = { template: { id: number; name: string }; rows: Row[]; next: Row | null; running: Row | null; timedMin: number };
	let { plan, form }: { plan: Plan; form: { timer?: string; stepId?: number; error?: string } | null | undefined } = $props();

	// Live counter: the server sends when the timer started; the phone counts from there, so
	// locking the phone or reloading never loses it.
	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	const sleepy = (r: Row) => r.icon === 'moon' || r.icon === 'bed';
	const elapsed = (r: Row) => (r.completedAt ? Math.max(0, Math.floor((now - Date.parse(r.completedAt)) / 1000)) : 0);
	const two = (n: number) => String(n).padStart(2, '0');
	/** 42:07, or 1:42:07 past an hour. */
	const clock = (sec: number) => {
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		return h ? `${h}:${two(m)}:${two(sec % 60)}` : `${m}:${two(sec % 60)}`;
	};
	const dur = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`);
	/** Minutes after the plan's midnight → "HH:MM" for a time picker. */
	const hm = (m: number | null) => {
		if (m === null) return '';
		const x = ((m % 1440) + 1440) % 1440;
		return `${two(Math.floor(x / 60))}:${two(x % 60)}`;
	};
	const nowHm = () => {
		const d = new Date(now);
		return `${two(d.getHours())}:${two(d.getMinutes())}`;
	};

	const running = $derived(plan.running);
	// The next step is a timer that has not started: offer the big Start.
	const startable = $derived(!running && plan.next && plan.next.timer && !plan.next.completedAt ? plan.next : null);
	const runningMin = $derived(running ? Math.floor(elapsed(running) / 60) : 0);
	const totalMin = $derived(plan.timedMin + runningMin);
	const timers = $derived(plan.rows.filter((r) => r.timer && (r.done || r.running)).length);

	// Undo for a few seconds after a stop: a mis-tap at 3 am costs nothing.
	let undo = $state<{ id: number; title: string; until: number } | null>(null);
	$effect(() => {
		if (form?.timer === 'stop' && form.stepId) {
			const r = plan.rows.find((x) => x.id === form.stepId);
			undo = { id: form.stepId, title: r?.title ?? 'Timer', until: Date.now() + 6000 };
		}
	});
	const showUndo = $derived(undo !== null && now < undo.until);

	let pickStart = $state(false);
	let pickStop = $state(false);
	let fixStart = $state(false);
	const AGO = [5, 10, 15, 20];
</script>

{#if running}
	{@const sec = elapsed(running)}
	<section class="timer night" aria-live="polite">
		<div class="eyebrow-n"><Glyph name={running.icon} size={20} /> {running.title} · {sleepy(running) ? 'asleep' : 'running'}</div>
		<div class="count" role="timer" aria-label={`${Math.floor(sec / 60)} minutes`}>{clock(sec)}</div>
		<p class="since">
			since {running.time}{#if running.usualMin}{' · '}usually {dur(running.usualMin)}{#if runningMin > running.usualMin}<span class="over">{' · '}{dur(runningMin - running.usualMin)} over</span>{/if}{/if}
		</p>
		<form method="POST" action="?/timer" use:enhance={keep()}>
			<input type="hidden" name="stepId" value={running.id} />
			<input type="hidden" name="op" value="stop" />
			<button class="big wake" name="ago" value="0">{sleepy(running) ? 'Awake' : `Stop ${running.title}`}</button>
			<div class="agos">
				<span>{sleepy(running) ? 'woke' : 'stopped'}</span>
				{#each AGO.slice(0, 3) as m (m)}<button class="ago" name="ago" value={m}>{m} min ago</button>{/each}
				<button type="button" class="ago" aria-expanded={pickStop} onclick={() => (pickStop = !pickStop)}>at…</button>
			</div>
		</form>
		{#if pickStop}
			<form method="POST" action="?/timer" use:enhance={keep()} class="at" onsubmit={() => (pickStop = false)}>
				<input type="hidden" name="stepId" value={running.id} />
				<input type="hidden" name="op" value="stop" />
				<input type="time" name="time" value={nowHm()} required aria-label="Time it stopped" />
				<button>Save</button>
			</form>
		{/if}
		<div class="minor">
			<button type="button" class="link" onclick={() => (fixStart = !fixStart)}>Fix start time</button>
			<form method="POST" action="?/toggle" use:enhance={keep()}>
				<input type="hidden" name="stepId" value={running.id} />
				<input type="hidden" name="done" value="0" />
				<button
					class="link"
					onclick={(e) => {
						if (!confirm(`Cancel this ${running.title.toLowerCase()}? It goes back to not started.`)) e.preventDefault();
					}}>Cancel</button
				>
			</form>
		</div>
		{#if fixStart}
			<form method="POST" action="?/retime" use:enhance={keep()} class="at" onsubmit={() => (fixStart = false)}>
				<input type="hidden" name="stepId" value={running.id} />
				<span>{sleepy(running) ? 'Went down at' : 'Started at'}</span>
				<input type="time" name="time" value={hm(running.minutes)} required aria-label="Start time" />
				<button>Save</button>
			</form>
		{/if}
	</section>
{:else if startable}
	<section class="timer start">
		<div class="eyebrow-s">
			<Glyph name={startable.icon} size={20} /> Next: {startable.title}
			{#if startable.time}<span class="muted">{startable.estimate ? '~' : ''}{startable.time}</span>{/if}
			{#if startable.usualMin}<span class="muted">· usually {dur(startable.usualMin)}</span>{/if}
		</div>
		<form method="POST" action="?/timer" use:enhance={keep()}>
			<input type="hidden" name="stepId" value={startable.id} />
			<input type="hidden" name="op" value="start" />
			<button class="big go" name="ago" value="0">Start {startable.title.toLowerCase()} · now</button>
			<div class="agos">
				<span>{sleepy(startable) ? 'went down' : 'started'}</span>
				{#each AGO as m (m)}<button class="ago" name="ago" value={m}>{m} min ago</button>{/each}
				<button type="button" class="ago" aria-expanded={pickStart} onclick={() => (pickStart = !pickStart)}>at…</button>
			</div>
		</form>
		{#if pickStart}
			<form method="POST" action="?/timer" use:enhance={keep()} class="at" onsubmit={() => (pickStart = false)}>
				<input type="hidden" name="stepId" value={startable.id} />
				<input type="hidden" name="op" value="start" />
				<input type="time" name="time" value={nowHm()} required aria-label="Time it started" />
				<button>Start</button>
			</form>
		{/if}
	</section>
{:else if plan.next}
	<p class="nextline">
		<span class="label">Next</span>
		<strong>{plan.next.title}</strong>
		{#if plan.next.time}<span>{plan.next.estimate ? '~' : ''}{plan.next.time}</span>{/if}
		{#if plan.next.rule && !plan.next.rule.startsWith('at ')}<span class="muted">· {plan.next.rule}</span>{/if}
	</p>
{/if}

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<ul class="card steps plan">
	{#each plan.rows as r, si (r.id)}
		<li class:done={r.done} class:next={r.next} class:running={r.running}>
			{#if r.timer && !r.completedAt}
				<!-- A timer step not started: the circle starts it now. -->
				<form method="POST" action="?/timer" use:enhance={keep()}>
					<input type="hidden" name="stepId" value={r.id} />
					<input type="hidden" name="op" value="start" />
					<input type="hidden" name="ago" value="0" />
					<button class="tick" aria-label={`Start ${r.title}`} data-step={r.title}><Glyph name="clock" size={18} /></button>
				</form>
			{:else if r.running}
				<form method="POST" action="?/timer" use:enhance={keep()}>
					<input type="hidden" name="stepId" value={r.id} />
					<input type="hidden" name="op" value="stop" />
					<input type="hidden" name="ago" value="0" />
					<button class="tick live" aria-label={`Stop ${r.title}`} data-step={r.title}><span class="pulse"></span></button>
				</form>
			{:else}
				<form method="POST" action="?/toggle" use:enhance={keep()}>
					<input type="hidden" name="stepId" value={r.id} />
					<input type="hidden" name="done" value={r.done ? '0' : '1'} />
					<button class="tick" aria-pressed={r.done} aria-label={`${r.done ? 'Untick' : 'Tick'} ${r.title}`} data-step={r.title}>
						{#if r.done}<Glyph name="check" size={18} />{/if}
					</button>
				</form>
			{/if}
			<span class="ptime" class:est={r.estimate}>
				{#if r.completedAt}
					<details class="retime">
						<summary aria-label={`Change the time of ${r.title}`}>{r.time}<Glyph name="pencil" size={14} /></summary>
						<div class="panel">
							<form method="POST" action="?/retime" use:enhance={keep()} onsubmit={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
								<span class="muted">{r.timer ? (sleepy(r) ? 'Went down at' : 'Started at') : `${r.title} happened at`}</span>
								<input type="hidden" name="stepId" value={r.id} />
								<input type="time" name="time" value={hm(r.minutes)} required aria-label="Time it happened" />
								<button>Save</button>
							</form>
							{#if r.timer && r.endMinutes !== null}
								<form method="POST" action="?/timer" use:enhance={keep()} onsubmit={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
									<span class="muted">{sleepy(r) ? 'Woke at' : 'Stopped at'}</span>
									<input type="hidden" name="stepId" value={r.id} />
									<input type="hidden" name="op" value="end" />
									<input type="time" name="time" value={hm(r.endMinutes)} required aria-label="Time it stopped" />
									<button>Save</button>
								</form>
							{/if}
						</div>
					</details>
				{:else}
					{r.time ? `${r.estimate ? '~' : ''}${r.time}` : '—'}
				{/if}
			</span>
			<span class="chip tone-{si % 5}"><Glyph name={r.icon} size={22} /></span>
			<span class="title">
				<span class="t">{r.title}</span>
				{#if r.running}
					<span class="when live-note">{sleepy(r) ? 'asleep' : 'running'} · {clock(elapsed(r))}</span>
				{:else if r.timer && r.endTime}
					<span class="muted when">until {r.endTime}{r.durationMin !== null ? ` · ${dur(r.durationMin)}` : ''}</span>
				{:else if !r.done && r.rule}
					<span class="muted when">{r.rule}{r.timer && r.usualMin ? ` · usually ${dur(r.usualMin)}` : ''}</span>
				{/if}
			</span>
		</li>
	{:else}
		<li class="muted quiet">No steps yet. <a href={`/planner/routines/${plan.template.id}`}>Add some</a>.</li>
	{/each}
</ul>
{#if timers}
	<p class="total">{plan.rows.some((r) => r.timer && sleepy(r)) ? 'Slept' : 'Timed'} <strong>{dur(totalMin)}</strong> today · {timers} {timers === 1 ? 'time' : 'times'}</p>
{/if}
<p class="muted small">
	Tap a circle when it happens; tap a time to change it. ~ is a guess until the step before is done. <a href={`/planner/routines/${plan.template.id}`}>Edit plan</a>
</p>

{#if showUndo && undo}
	<div class="undo" role="status">
		<span>{undo.title} stopped</span>
		<!-- Hide the bar only once the request is under way: removing the form first cancels it. -->
		<form
			method="POST"
			action="?/timer"
			use:enhance={() =>
				async ({ update }) => {
					undo = null;
					await update({ reset: false });
				}}
		>
			<input type="hidden" name="stepId" value={undo.id} />
			<input type="hidden" name="op" value="unstop" />
			<button class="link">Undo</button>
		</form>
	</div>
{/if}

<style>
	/* ---- Timer card ---- */
	.timer {
		border-radius: 24px;
		padding: 18px 18px 14px;
		margin: 16px 0 12px;
	}
	.night {
		background: #1f2340;
		color: #f6efe4;
		box-shadow: 0 14px 30px -18px rgba(20, 20, 60, 0.7);
		--glyph-bg: #f4a72c;
		--glyph-bg-opacity: 0.35;
	}
	.start {
		background: var(--card);
		border: 1.5px solid var(--line-strong);
	}
	.eyebrow-n,
	.eyebrow-s {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		font-weight: 600;
		font-size: 0.95rem;
	}
	.eyebrow-n {
		color: #cfc8e8;
	}
	.count {
		font-family: var(--serif);
		font-variation-settings: 'SOFT' 100;
		font-weight: 600;
		font-size: clamp(3.4rem, 18vw, 4.6rem);
		line-height: 1;
		margin: 10px 0 4px;
		font-variant-numeric: tabular-nums;
		letter-spacing: -1px;
	}
	.since {
		margin: 0 0 14px;
		color: #cfc8e8;
	}
	.over {
		color: #f6b955;
	}
	.big {
		display: block;
		width: 100%;
		min-height: 60px;
		font-size: 1.25rem;
		border-radius: 20px;
	}
	.wake {
		background: #f4a72c;
		border-color: #f4a72c;
		color: #23253a;
	}
	.go {
		background: #1f2340;
		border-color: #1f2340;
		color: #f6efe4;
	}
	.agos {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		font-size: 0.85rem;
	}
	.agos > span {
		margin-right: 2px;
		opacity: 0.8;
	}
	.ago {
		padding: 7px 12px;
		font-size: 0.9rem;
		font-weight: 600;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		border: 1.5px solid currentColor;
		opacity: 0.9;
	}
	.night .ago {
		border-color: #565b86;
	}
	.start .ago {
		border-color: var(--line-strong);
	}
	.at {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}
	.at input,
	.panel input {
		font: inherit;
		padding: 8px 10px;
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.minor {
		display: flex;
		justify-content: space-between;
		margin-top: 12px;
	}
	.minor form {
		margin: 0;
	}
	.night .link {
		color: #cfc8e8;
		text-decoration: underline;
	}

	/* ---- Timetable ---- */
	.nextline {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
		margin: 16px 4px 10px;
		font-size: 1.05rem;
	}
	.nextline .label {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 4px 14px;
	}
	.steps li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
	}
	.steps li + li {
		border-top: 1px solid var(--line);
	}
	.steps form {
		margin: 0;
	}
	li.next {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		margin: 0 -14px;
		padding-left: 14px;
		padding-right: 14px;
	}
	li.running {
		background: color-mix(in srgb, #1f2340 10%, transparent);
		margin: 0 -14px;
		padding-left: 14px;
		padding-right: 14px;
	}
	.tick {
		width: 44px;
		height: 44px;
		padding: 0;
		border-radius: 50%;
		border: 2.5px solid var(--ink);
		background: var(--card);
		color: var(--ink);
		display: grid;
		place-items: center;
		transition: background 0.15s, border-color 0.15s;
	}
	li.done .tick {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.tick.live {
		border-color: #1f2340;
		background: #1f2340;
	}
	.pulse {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #f4a72c;
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			transform: scale(1.5);
			opacity: 0.5;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse {
			animation: none;
		}
	}
	.ptime {
		flex: none;
		width: 5.6em;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.ptime.est {
		color: var(--muted);
		font-weight: 500;
	}
	li.done .ptime {
		color: var(--muted);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.t {
		font-size: 1.08rem;
		font-weight: 600;
	}
	li.done .t {
		font-weight: 500;
		color: var(--muted);
		text-decoration: line-through;
		text-decoration-color: var(--accent);
		text-decoration-thickness: 2px;
	}
	.when {
		font-size: 0.82rem;
	}
	.live-note {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.quiet {
		padding: 14px 0;
	}
	.retime summary {
		list-style: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		text-decoration: underline dotted;
	}
	.retime summary::-webkit-details-marker {
		display: none;
	}
	/* The time editor opens as a small panel under the row. */
	.panel {
		position: absolute;
		z-index: 2;
		left: 0;
		right: 0;
		top: calc(100% - 6px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px 12px;
		background: var(--card);
		border: 1.5px solid var(--line-strong);
		border-radius: 14px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
		font-weight: 500;
	}
	.panel form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.panel .muted {
		flex-basis: 100%;
		font-size: 0.85rem;
	}
	.total {
		margin: 10px 4px 0;
	}
	.small {
		font-size: 0.85rem;
		margin: 8px 4px 0;
	}

	/* ---- Undo bar ---- */
	.undo {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(84px + env(safe-area-inset-bottom));
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 12px 18px;
		border-radius: 16px;
		background: #1f2340;
		color: #f6efe4;
		box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
	}
	.undo form {
		margin: 0;
	}
	.undo .link {
		color: #f4a72c;
		font-weight: 700;
	}
</style>
