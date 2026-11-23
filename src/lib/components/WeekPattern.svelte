<script lang="ts">
	import { enhance } from '$app/forms';
	import { keep } from '$lib/enhance';
	import Glyph from './Glyph.svelte';
	type DT = { id: number; name: string; glyph: string };
	let {
		memberId,
		dayTypes,
		pattern,
		todayWeekday = null
	}: { memberId: number; dayTypes: DT[]; pattern: Record<number, number>; todayWeekday?: number | null } = $props();
	// Monday first: that is how families read a week.
	const DAYS: Array<[number, string]> = [
		[1, 'Mon'],
		[2, 'Tue'],
		[3, 'Wed'],
		[4, 'Thu'],
		[5, 'Fri'],
		[6, 'Sat'],
		[0, 'Sun']
	];
</script>

<!-- One tap sets a weekday's type; tapping the chosen type again clears it. Saved on tap. -->
<div class="week">
	{#each DAYS as [wd, label] (wd)}
		<form method="POST" action="?/patternDay" use:enhance={keep()} class="day" class:today={wd === todayWeekday}>
			<input type="hidden" name="memberId" value={memberId} />
			<input type="hidden" name="weekday" value={wd} />
			<span class="label">{label}{#if wd === todayWeekday}<small>today</small>{/if}</span>
			<div class="choices">
				{#each dayTypes as dt, ti (dt.id)}
					{@const on = pattern[wd] === dt.id}
					<button class="choice tone-{(ti + 1) % 5}" name="dayTypeId" value={on ? '' : dt.id} aria-pressed={on} aria-label={`${label}: ${dt.name}`}>
						<Glyph name={dt.glyph} size={18} />
						{dt.name}
					</button>
				{/each}
			</div>
		</form>
	{/each}
</div>

<style>
	.week {
		display: flex;
		flex-direction: column;
	}
	.day {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
		border-top: 1px solid var(--line);
		margin: 0;
	}
	.day:first-child {
		border-top: none;
	}
	.label {
		width: 3.2em;
		flex: none;
		font-weight: 700;
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.label small {
		font-weight: 600;
		font-size: 0.7rem;
		color: var(--accent);
	}
	.choices {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
		gap: 4px;
	}
	.choice {
		flex-direction: column;
		justify-content: center;
		gap: 0;
		padding: 4px 2px;
		min-height: 48px;
		border-radius: 10px;
		font-size: 0.75rem;
		line-height: 1.15;
	}
</style>
