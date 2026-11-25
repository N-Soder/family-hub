<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { keep } from '$lib/enhance';
	import Glyph from '$lib/components/Glyph.svelte';
	import ListFields from '$lib/components/ListFields.svelte';
	import { byShop, readShopPick, saveShopPick } from '$lib/shop-filter';
	import type { ActionData, PageData } from '../../routes/planner/lists/$types';
	// Shared by the Lists and Tasks sides (ADR-40); `data.side` says which.
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const sideName = $derived(data.side === 'tasks' ? 'Tasks' : 'Lists');
	// New lists default to this side's kind.
	const kinds = $derived(
		data.side === 'tasks'
			? [['todo', 'To-do'], ['grocery', 'Shopping'], ['other', 'Other']]
			: [['grocery', 'Shopping'], ['other', 'Other'], ['todo', 'To-do (goes to Tasks)']]
	);

	const list = $derived(data.detail?.list ?? null);
	// Shopping lists stay simple: no dates or repeats, and the whole row ticks. Coming up only has
	// dated (to-do/other) items, so its rows are always the to-do kind.
	const canPlan = $derived(list === null || list.kind !== 'grocery');
	// A list page posts back to itself, so a plain (no-JS) post lands on the same list (ADR-39).
	const act = (name: string) => (list ? `?list=${list.id}&/${name}` : `?/${name}`);
	let menu = $state(false); // the ⋯ panel: list settings, clear, delete
	let editing = $state(false); // rename / reorder / delete items
	let creating = $state(false); // the + on the index: new list
	let addInput: HTMLInputElement | undefined = $state();

	// Shops (ADR-41): lists on the Lists side only. Picking one hides items tied to another shop.
	const shops = $derived(data.detail?.shops ?? []);
	const shopById = $derived(new Map(shops.map((s) => [s.id, s])));
	let shopPick = $state<number | null>(null);
	let peek = $state(false); // show the hidden items, dimmed
	// A shop removed elsewhere drops the filter.
	const atShop = $derived(shopPick !== null && shopById.has(shopPick) ? shopPick : null);
	const filtered = $derived(byShop(data.detail?.open ?? [], atShop));
	const hiddenIds = $derived(new Set(filtered.hidden.map((i) => i.id)));
	const hiddenFor = $derived([...new Set(filtered.hidden.map((i) => shopById.get(i.shopId!)?.name ?? ''))].join(' or '));
	function pickShop(id: number | null) {
		shopPick = id;
		peek = false;
		if (list) saveShopPick(globalThis.localStorage, list.id, id);
	}

	// Switching list closes whatever was open.
	let shownId: number | null = null;
	$effect(() => {
		if (list?.id !== shownId) {
			shownId = list?.id ?? null;
			menu = editing = creating = peek = false;
			shopPick = list ? readShopPick(globalThis.localStorage, list.id, shops.map((s) => s.id)) : null;
		}
	});

	// Show a tick straight away; the server reply then moves the row.
	const flipping = new SvelteSet<number>();
	const tick =
		(itemId: number): SubmitFunction =>
		() => {
			flipping.add(itemId);
			navigator.vibrate?.(8);
			return async ({ update }) => {
				await update({ reset: false });
				flipping.delete(itemId);
			};
		};

	// Clear the box and keep the keyboard up so items can be added one after another.
	const add: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success' && addInput) addInput.value = '';
			addInput?.focus();
		};

	// Ticked rows stay in place for a short grace (to undo a mis-tap), then move to Ticked.
	$effect(() => {
		const ms = data.regraceIn;
		if (ms === null || ms === undefined) return;
		const t = setTimeout(() => invalidateAll(), ms + 500);
		return () => clearTimeout(t);
	});

	// Live: another phone adding or ticking refreshes this list.
	onMount(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('change', () => invalidateAll());
		return () => es.close();
	});
</script>

{#snippet notices()}
	{@const shown = form?.notice ? form : (data.doneNotice ?? null)}
	{#if shown?.notice}
		<div class="muted note" role="status">
			{shown.notice}
			{#if shown.undo}
				<form method="POST" action={act('undo')} use:enhance={keep()} class="inline">
					<input type="hidden" name="logId" value={shown.undo} />
					<button class="link undo">Undo</button>
				</form>
			{/if}
		</div>
	{/if}
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
{/snippet}

{#snippet details(item: (typeof data.coming)[number] | NonNullable<typeof data.detail>['open'][number], from: string | null)}
	<span class="title">
		{item.title}
		{#if item.meta || item.nowSince || from}
			<span class="meta">
				{#if item.meta}<span class="due {item.meta.state}">{item.meta.label}</span>{:else if item.nowSince}<span class="due now">Now</span>{/if}
				{#if item.meta?.repeat}<span class="muted"><Glyph name="refresh" size={14} /> {item.meta.repeat}</span>{/if}
				{#if from}<span class="muted">{from}</span>{/if}
			</span>
		{/if}
		{#if item.notes}
			<span class="notes muted"><Glyph name={/(https?:\/\/|www\.)/i.test(item.notes) ? 'link' : 'note'} size={14} /> <span>{item.notes.split('\n')[0]}</span></span>
		{/if}
		{#if item.meta?.progress != null}<span class="bar {item.meta.state}" style="--p:{item.meta.progress}"></span>{/if}
	</span>
{/snippet}

{#snippet shopTag(item: { shopId?: number | null })}
	{@const shop = item.shopId ? shopById.get(item.shopId) : undefined}
	{#if shop && shop.id !== atShop}<span class="shop tone-{shop.tone}"><span class="dot"></span>{shop.name}</span>{/if}
{/snippet}

<!-- One open item. To-do lists: the circle ticks it (a repeating one is done and comes back
     later), the rest of the row opens it. Shopping: the whole row ticks it, ⋯ opens it.
     A one-off ticked a moment ago stays here struck through; a tap puts it back. -->
{#snippet row(item: (typeof data.coming)[number] | NonNullable<typeof data.detail>['open'][number], listId: number, from: string | null = null)}
	{@const ticked = Boolean(item.doneAt)}
	{@const on = ticked !== flipping.has(item.id)}
	<li class:done={on} class:away={hiddenIds.has(item.id)}>
		{#if canPlan}
			<form class="tick" method="POST" action={act('toggle')} use:enhance={tick(item.id)}>
				<input type="hidden" name="listId" value={listId} />
				<input type="hidden" name="itemId" value={item.id} />
				<input type="hidden" name="done" value={ticked ? '0' : '1'} />
				<button class="check" aria-pressed={ticked} aria-label={ticked ? `Put ${item.title} back on the list` : `Mark ${item.title} done`}>
					<span class="box">{#if on}<Glyph name="check" size={16} />{/if}</span>
				</button>
			</form>
			<a class="item open" href={`/planner/lists/item/${item.id}`}>{@render details(item, from)}{@render shopTag(item)}</a>
		{:else}
			<form method="POST" action={act('toggle')} use:enhance={tick(item.id)}>
				<input type="hidden" name="listId" value={listId} />
				<input type="hidden" name="itemId" value={item.id} />
				<input type="hidden" name="done" value={ticked ? '0' : '1'} />
				<button class="item" aria-pressed={ticked}>
					<span class="box">{#if on}<Glyph name="check" size={16} />{/if}</span>
					{@render details(item, from)}
					{@render shopTag(item)}
				</button>
			</form>
			<a class="more" href={`/planner/lists/item/${item.id}`} aria-label={`Details for ${item.title}`}><Glyph name="more" size={20} /></a>
		{/if}
	</li>
{/snippet}

{#if list && data.detail}
	<BackLink href={`/planner/${data.side}`} label={sideName} />
	<div class="head">
		<h1>{list.name}</h1>
		{#if editing}
			<button class="small" onclick={() => (editing = false)}>Done</button>
		{:else}
			<button class="plain" onclick={() => (menu = !menu)} aria-expanded={menu} aria-label="List options"><Glyph name="more" size={26} /></button>
		{/if}
	</div>

	{#if menu}
		<div class="card menu">
			<div class="row">
				{#if data.detail.all.length}
					<button class="ghost" onclick={() => ((editing = true), (menu = false))}>Edit items</button>
				{/if}
				{#if data.detail.done.length}
					<form method="POST" action={act('clearDone')} use:enhance={keep()}>
						<input type="hidden" name="listId" value={list.id} />
						<button class="ghost">Clear {data.detail.done.length} ticked</button>
					</form>
				{/if}
			</div>
			{#if data.suggestions.length}
				<details class="sub">
					<summary>Add a repeating house job</summary>
					<p class="muted small">Each one comes with a repeat; check its date after adding.</p>
					<div class="row">
						{#each data.suggestions as sug (sug.key)}
							<form method="POST" action={act('suggest')}>
								<input type="hidden" name="listId" value={list.id} />
								<input type="hidden" name="key" value={sug.key} />
								<button class="ghost"><Glyph name="plus" size={16} /> {sug.title}</button>
							</form>
						{/each}
					</div>
				</details>
			{/if}
			{#if data.side === 'lists'}
				<details class="sub" open={Boolean(form?.shopErrors || form?.shopAdded)}>
					<summary>Shops</summary>
					<p class="muted small">Tie items to a shop on their page, then pick a shop above the list to hide what's bought elsewhere.</p>
					{#if shops.length}
						<ul class="shops">
							{#each shops as shop (shop.id)}
								<li class="tone-{shop.tone}">
									<span class="dot"></span><span class="name">{shop.name}</span>
									<form method="POST" action={act('removeShop')} use:enhance={keep()}>
										<input type="hidden" name="listId" value={list.id} />
										<input type="hidden" name="shopId" value={shop.id} />
										<button class="link danger" aria-label={`Remove ${shop.name}`}>Remove</button>
									</form>
								</li>
							{/each}
						</ul>
					{/if}
					{#if shops.length < 4}
						<form class="row add-shop" method="POST" action={act('addShop')} use:enhance={keep(['name'])}>
							<input type="hidden" name="listId" value={list.id} />
							<input name="name" placeholder="Add a shop" aria-label="New shop" maxlength="20" autocomplete="off" autocapitalize="words" enterkeyhint="done" required />
							<button>Add</button>
						</form>
					{/if}
					{#if form?.shopErrors?.name}<p class="error">{form.shopErrors.name}</p>{/if}
				</details>
			{/if}
			<details class="sub" open={Boolean(form?.listErrors && !form.listErrors.confirm)}>
				<summary>Rename or change icon</summary>
				<form method="POST" action={act('save')} use:enhance={keep()}>
					<input type="hidden" name="listId" value={list.id} />
					<ListFields values={list} errors={form?.listErrors ?? {}} />
					<button>Save</button>
				</form>
			</details>
			<details class="sub" open={Boolean(form?.listErrors?.confirm)}>
				<summary>Delete list</summary>
				<form method="POST" action={act('deleteList')}>
					<input type="hidden" name="listId" value={list.id} />
					<label class="row"><input type="checkbox" name="confirm" /> Delete “{list.name}” and everything on it</label>
					{#if form?.listErrors?.confirm}<p class="error">{form.listErrors.confirm}</p>{/if}
					<button class="ghost danger">Delete list</button>
				</form>
			</details>
		</div>
	{/if}

	{@render notices()}
	<!-- The shop switch (ADR-41): plain words like the Lists · Tasks · Notes · Gifts switch. -->
	{#if shops.length && !editing}
		<div class="shop-switch" role="group" aria-label="Shopping at">
			<button aria-pressed={atShop === null} class:on={atShop === null} onclick={() => pickShop(null)}>All</button>
			{#each shops as shop (shop.id)}
				<button aria-pressed={atShop === shop.id} class:on={atShop === shop.id} class="tone-{shop.tone}" onclick={() => pickShop(shop.id)}><span class="dot"></span>{shop.name}</button>
			{/each}
		</div>
	{/if}
	{#if canPlan && !data.detail.all.length && !data.detail.done.length}<p class="muted small">Tap the circle to tick an item. Tap the item to add notes, a due date or a repeat, like “Service the car every 12 months”.</p>{/if}

	<ul class="items card">
		{#each editing ? data.detail.all : peek ? data.detail.open : filtered.shown as item, i (item.id)}
			{#if !editing}
				{@render row(item, list.id)}
			{:else}
			<li>
					<form method="POST" action={act('rename')} use:enhance={keep()} class="rename">
						<input type="hidden" name="listId" value={list.id} />
						<input type="hidden" name="itemId" value={item.id} />
						<input name="title" value={item.title} aria-label={`Rename ${item.title}`} maxlength="80" required onchange={(e) => e.currentTarget.form?.requestSubmit()} />
					</form>
					<form method="POST" use:enhance={keep()} class="tools">
						<input type="hidden" name="listId" value={list.id} />
						<input type="hidden" name="itemId" value={item.id} />
						{#if canPlan && !item.repeatEvery}
							<button class="ghost now" class:on={item.nowSince} formaction={act('now')} name="now" value={item.nowSince ? '0' : '1'} aria-pressed={Boolean(item.nowSince)} aria-label={`${item.nowSince ? 'Unflag' : 'Flag'} ${item.title} Now`}>Now</button>
						{/if}
						<button class="ghost icon" formaction={act('up')} disabled={i === 0} aria-label={`Move ${item.title} up`}>↑</button>
						<button class="ghost icon" formaction={act('down')} disabled={i === data.detail.all.length - 1} aria-label={`Move ${item.title} down`}>↓</button>
						<button class="ghost icon danger" formaction={act('remove')} aria-label={`Delete ${item.title}`}>✕</button>
					</form>
			</li>
			{/if}
		{:else}
			{#if filtered.hidden.length}<li class="empty muted">Nothing else for {shopById.get(atShop!)?.name}.</li>
			{:else if data.detail.done.length || data.detail.later.length}<li class="empty muted">All done.</li>{/if}
		{/each}
		<!-- Adding is the last row of the list (ADR-39). Enter adds and keeps the keyboard up. -->
		{#if !editing}
			<li class="add-row">
				<form class="add" method="POST" action={act('add')} use:enhance={add}>
					<input type="hidden" name="listId" value={list.id} />
					<button class="plain plus" aria-label="Add"><Glyph name="plus" size={24} /></button>
					<input
						bind:this={addInput}
						name="title"
						placeholder="Add an item"
						aria-label="New item"
						maxlength="80"
						autocomplete="off"
						autocapitalize="sentences"
						enterkeyhint="done"
						required
					/>
				</form>
			</li>
		{/if}
	</ul>
	{#if form?.errors?.title}<p class="error">{form.errors.title}</p>{/if}
	{#if filtered.hidden.length && !editing}
		<p class="hidden-line muted">
			{filtered.hidden.length} {filtered.hidden.length === 1 ? 'item' : 'items'} for {hiddenFor} {peek ? 'shown' : 'hidden'}
			<button class="link" onclick={() => (peek = !peek)}>{peek ? 'Hide' : 'Show'}</button>
		</p>
	{/if}

	{#if data.detail.later.length && !editing}
		<details class="fold">
			<summary>Later <span class="n">{data.detail.later.length}</span></summary>
			<ul class="items card">
				{#each data.detail.later as item (item.id)}
					<li>
						<a class="item later" href={`/planner/lists/item/${item.id}`}>
							<span class="title">
								{item.title}
								{#if item.meta}<span class="meta"><span class="due later">{item.meta.label}</span><span class="muted"><Glyph name="refresh" size={14} /> {item.meta.repeat}</span></span>{/if}
								{#if item.meta?.progress != null}<span class="bar later" style="--p:{item.meta.progress}"></span>{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if data.detail.done.length && !editing}
		<details class="fold">
			<summary>Ticked <span class="n">{data.detail.done.length}</span></summary>
			<ul class="items card">
				{#each data.detail.done as item (item.id)}
					<li class="done" class:undoing={flipping.has(item.id)}>
						<form method="POST" action={act('toggle')} use:enhance={tick(item.id)}>
							<input type="hidden" name="listId" value={list.id} />
							<input type="hidden" name="itemId" value={item.id} />
							<input type="hidden" name="done" value="0" />
							<button class="item" aria-pressed="true">
								<span class="box">{#if !flipping.has(item.id)}<Glyph name="check" size={16} />{/if}</span>
								<span class="title">{item.title}</span>
							</button>
						</form>
					</li>
				{/each}
			</ul>
			<form method="POST" action={act('clearDone')} use:enhance={keep()}>
				<input type="hidden" name="listId" value={list.id} />
				<button class="link clear">Clear ticked</button>
			</form>
		</details>
	{/if}
{:else}
	<div class="head">
		<h1>{sideName}</h1>
		<button class="plain plus" onclick={() => (creating = !creating)} aria-expanded={creating} aria-label="New list"><Glyph name="plus" size={26} /></button>
	</div>

	{#if creating || !data.lists.length}
		<form class="card new" method="POST" action="?/newList" use:enhance>
			<label class="field"
				>New list
				<input name="name" placeholder={data.side === 'tasks' ? 'e.g. House jobs' : 'e.g. Bunnings'} maxlength="60" required />
				{#if form?.newErrors?.name}<span class="error">{form.newErrors.name}</span>{/if}
			</label>
			<div class="row">
				<select name="kind" aria-label="Kind">
					{#each kinds as [v, label] (v)}<option value={v}>{label}</option>{/each}
				</select>
				<button>Create</button>
				{#if data.lists.length}<button type="button" class="ghost" onclick={() => (creating = false)}>Cancel</button>{/if}
			</div>
		</form>
	{/if}

	{@render notices()}
	<!-- Due, overdue and Now items from every list; the section only shows when there are any. -->
	{#if data.coming.length}
		<h2 class="label" id="h-coming">Coming up</h2>
		<ul class="items card" aria-labelledby="h-coming">
			{#each data.coming as item (item.id)}
				{@render row(item, item.listId, item.listName)}
			{/each}
		</ul>
	{/if}

	{#if data.lists.length}
		<h2 class="label" id="h-all">{data.side === 'tasks' ? 'To-do lists' : 'All lists'}</h2>
		<ul class="index card" aria-labelledby="h-all">
			{#each data.lists as l, li (l.id)}
				<li>
					<a href={`?list=${l.id}`} class="tone-{li % 5}">
						<Glyph name={l.icon} size={24} />
						<span class="name">{l.name}</span>
						{#if l.open}<span class="n">{l.open}</span>{/if}
						<span class="go"><Glyph name="back" size={18} /></span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/if}


<style>
	/* ADR-39 / docs/design.md: plain icons and text, colour on icons only, cards are the only
	   raised surface, nothing scrolls sideways. */
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 14px;
	}
	.head h1 {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/* +, ⋯: a bare icon with a 44 px tap area. */
	.plain {
		flex: none;
		width: 44px;
		height: 44px;
		padding: 0;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: 12px;
		color: var(--muted);
		-webkit-tap-highlight-color: transparent;
	}
	.plain.plus {
		color: var(--accent-ink);
		--glyph-bg-opacity: 0;
	}
	.head .plain {
		margin-right: -10px;
	}
	.label {
		font-family: var(--sans);
		font-variation-settings: normal;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
		margin: 22px 4px 8px;
	}
	.head + .label {
		margin-top: 4px;
	}
	/* The index: one row per list. */
	.index {
		list-style: none;
		padding: 0 16px;
	}
	.index li + li {
		border-top: 1px solid var(--line);
	}
	.index a {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 56px;
		color: var(--ink);
		text-decoration: none;
		font-weight: 500;
		font-size: 1.08rem;
		--glyph-bg: var(--tone);
		--glyph-bg-opacity: 0.35;
	}
	.index a > :global(.glyph) {
		color: var(--tone-ink);
	}
	.index .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		color: var(--muted);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.go {
		display: grid;
		transform: rotate(180deg);
		color: var(--line-strong);
		--glyph-bg-opacity: 0;
	}
	.small {
		padding: 7px 16px;
	}
	.menu {
		margin-top: 12px;
	}
	.menu .row form {
		margin: 0;
	}
	.sub {
		border-top: 1px solid var(--line);
		margin-top: 12px;
		padding-top: 10px;
	}
	.sub summary {
		cursor: pointer;
		font-weight: 600;
		padding: 4px 0;
	}
	.sub form {
		margin-top: 10px;
	}
	.sub label.row {
		margin-bottom: 10px;
	}
	.new select {
		padding: 10px 12px;
		border-radius: 14px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
	}
	/* Add: the last row of the items card. 17px so iOS does not zoom on focus. */
	.items li.add-row {
		gap: 0;
	}
	.items form.add {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0;
		margin-left: -7px;
	}
	.add input:not([type='hidden']) {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 17px;
		padding: 12px 0;
		border: none;
		background: none;
		color: var(--ink);
	}
	.add input::placeholder {
		color: var(--muted);
		opacity: 1;
	}
	.add input:focus-visible {
		outline: none;
	}
	.note {
		margin: 4px 0 8px;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 2px 14px;
	}
	.items li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 56px;
	}
	.items li + li {
		border-top: 1px solid var(--line);
	}
	.items form {
		margin: 0;
	}
	.items li > form:first-child {
		flex: 1;
		min-width: 0;
	}
	/* To-do rows: a 44 px circle button, then the row opens the item. */
	.items li > form.tick {
		flex: none;
		margin-left: -7px;
	}
	.check {
		width: 44px;
		height: 44px;
		padding: 0;
		display: grid;
		place-items: center;
		background: none;
		border: none;
		border-radius: 50%;
		-webkit-tap-highlight-color: transparent;
	}
	.check:active .box {
		background: var(--line);
	}
	a.item.open {
		flex: 1;
		min-width: 0;
		text-decoration: none;
		gap: 0;
	}
	.notes {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.85rem;
		min-width: 0;
	}
	.notes > span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		padding: 14px 0;
	}
	/* The whole row is the tap target. */
	.item {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		min-height: 56px;
		padding: 8px 0;
		background: none;
		border: none;
		color: var(--ink);
		font-weight: 500;
		font-size: 1.08rem;
		text-align: left;
		border-radius: 0;
		-webkit-tap-highlight-color: transparent;
	}
	.box {
		flex: none;
		width: 30px;
		height: 30px;
		box-sizing: border-box;
		border: 2.5px solid var(--ink);
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: var(--on-accent);
		transition: background 0.12s, border-color 0.12s;
	}
	li.done .box {
		background: var(--accent);
		border-color: var(--accent);
	}
	li.done.undoing .box {
		background: transparent;
		border-color: var(--ink);
	}
	li.done .title {
		text-decoration: line-through;
		text-decoration-color: var(--accent);
		text-decoration-thickness: 2px;
		color: var(--muted);
	}
	li.done.undoing .title {
		text-decoration: none;
		color: var(--ink);
	}
	/* Shops (ADR-41): a coloured dot is the only colour; names stay muted text. */
	.dot {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--tone);
	}
	.shop {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--muted);
		white-space: nowrap;
	}
	.shop-switch {
		display: flex;
		flex-wrap: wrap;
		gap: 0 22px;
		border-bottom: 1px solid var(--line);
		margin: -4px 0 14px;
	}
	.shop-switch button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 0;
		margin-bottom: -1px;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		color: var(--muted);
		font: inherit;
		font-weight: 500;
		-webkit-tap-highlight-color: transparent;
	}
	.shop-switch button.on {
		color: var(--ink);
		border-bottom-color: var(--accent);
	}
	li.away {
		opacity: 0.45;
	}
	.hidden-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin: 6px 4px 0;
		font-size: 0.92rem;
	}
	.hidden-line .link {
		color: var(--accent-ink);
		font-weight: 600;
		min-height: 44px;
	}
	.shops {
		list-style: none;
		margin: 6px 0 4px;
		padding: 0;
	}
	.shops li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
	}
	.shops li + li {
		border-top: 1px solid var(--line);
	}
	.shops .name {
		flex: 1;
	}
	.add-shop {
		flex-wrap: nowrap;
	}
	.add-shop input:not([type='hidden']) {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 17px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.shops form {
		margin: 0;
	}
	/* Later and Ticked: quiet text lines that open in place. */
	.fold {
		margin-top: 4px;
	}
	.items + .fold,
	.error + .fold {
		margin-top: 14px;
	}
	.fold summary {
		cursor: pointer;
		color: var(--muted);
		font-weight: 600;
		padding: 10px 4px;
		list-style: none;
		width: fit-content;
	}
	.fold summary::-webkit-details-marker {
		display: none;
	}
	.fold[open] summary {
		color: var(--ink);
	}
	.fold li.done .box {
		background: var(--muted);
		border-color: var(--muted);
	}
	.clear {
		margin: 12px 4px 0;
	}
	.small {
		font-size: 0.9rem;
	}
	.inline {
		display: inline;
		margin: 0 0 0 8px;
	}
	.undo {
		color: var(--accent-ink);
		font-weight: 600;
		text-decoration: underline;
	}
	/* Due date, repeat and (on Coming up) the list, under the title. */
	.title {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 0.85rem;
		font-weight: 500;
	}
	.meta :global(.glyph) {
		vertical-align: -2px;
	}
	.due {
		font-weight: 700;
		color: var(--teal-ink);
	}
	.due.soon,
	.due.today {
		color: var(--sun-ink);
	}
	.due.overdue {
		color: var(--tomato-ink);
	}
	.due.later {
		color: var(--muted);
	}
	.due.now {
		color: var(--tomato-ink);
	}
	/* Edit mode: flag an item Now. */
	.tools .now {
		padding: 6px 10px;
		font-weight: 700;
	}
	.tools .now.on {
		background: var(--tomato-ink);
		color: var(--card);
		border-color: var(--tomato-ink);
	}
	/* How far through its interval a repeating item is: fills up and warms as it gets due. */
	.bar {
		display: block;
		height: 5px;
		border-radius: 999px;
		margin-top: 4px;
		background: linear-gradient(to right, var(--bar) calc(var(--p) * 100%), var(--line) 0);
		--bar: var(--teal);
	}
	.bar.soon,
	.bar.today {
		--bar: var(--sun);
	}
	.bar.overdue {
		--bar: var(--tomato);
	}
	.more {
		flex: none;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		color: var(--muted);
	}
	a.item.later {
		text-decoration: none;
		color: var(--ink);
		padding-left: 44px;
	}
	.rename {
		flex: 1;
		min-width: 0;
	}
	.rename input:not([type='hidden']) {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 17px;
		padding: 8px 12px;
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
	}
	.tools {
		display: flex;
		gap: 4px;
	}
	.icon {
		width: 44px;
		height: 44px;
		padding: 0;
		border-width: 1px;
	}
	button:disabled {
		opacity: 0.35;
	}
	.danger {
		color: var(--warn);
	}
</style>
