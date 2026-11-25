import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// SPEC §5. Stage 1 tables plus shared lists (Stage 2); task/habit tables are still to come.

export const member = sqliteTable('member', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	shortLabel: text('short_label').notNull(),
	kind: text('kind', { enum: ['child', 'adult', 'baby'] }).notNull(),
	sort: integer('sort').notNull().default(0),
	icon: text('icon').notNull().default('star'),
	displayMode: text('display_mode', { enum: ['picture', 'reader'] }).notNull().default('reader'),
	active: integer('active', { mode: 'boolean' }).notNull().default(true)
});

export const dayType = sqliteTable('day_type', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	glyph: text('glyph').notNull(),
	sort: integer('sort').notNull().default(0)
});

export const weeklyPattern = sqliteTable(
	'weekly_pattern',
	{
		memberId: integer('member_id').notNull().references(() => member.id),
		weekday: integer('weekday').notNull(), // 0 = Sunday … 6 = Saturday
		dayTypeId: integer('day_type_id').notNull().references(() => dayType.id)
	},
	(t) => [primaryKey({ columns: [t.memberId, t.weekday] })]
);

export const dayOverride = sqliteTable(
	'day_override',
	{
		memberId: integer('member_id').notNull().references(() => member.id),
		localDate: text('local_date').notNull(),
		dayTypeId: integer('day_type_id').notNull().references(() => dayType.id),
		note: text('note'),
		source: text('source', { enum: ['admin', 'calendar'] }).notNull()
	},
	(t) => [primaryKey({ columns: [t.memberId, t.localDate] })]
);

export const routineTemplate = sqliteTable('routine_template', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	memberId: integer('member_id').notNull().references(() => member.id),
	name: text('name').notNull(),
	// 'plan': a baby's day timetable (SPEC §12.3); its window is not used.
	kind: text('kind', { enum: ['morning', 'after_school', 'bedtime', 'custom', 'plan'] }).notNull(),
	windowStart: text('window_start').notNull(), // HH:MM local
	windowEnd: text('window_end').notNull(), // HH:MM local; < start means it crosses midnight
	daysOfWeek: integer('days_of_week').notNull().default(127), // bit 0 = Sunday
	active: integer('active', { mode: 'boolean' }).notNull().default(true)
});

export const routineStep = sqliteTable('routine_step', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	templateId: integer('template_id').notNull().references(() => routineTemplate.id),
	title: text('title').notNull(),
	sort: integer('sort').notNull().default(0),
	icon: text('icon'),
	dayTypeIdsJson: text('day_type_ids_json'), // null = every day; else JSON number[]
	// Plan steps only (SPEC §12.3): due at a clock time, or N minutes after an earlier step.
	dueAt: text('due_at'), // HH:MM local
	dueAfterStepId: integer('due_after_step_id'),
	dueAfterMin: integer('due_after_min'),
	// Timer step (plan steps only): started and stopped ("Sleep"); steps after it follow its stop.
	timer: integer('timer', { mode: 'boolean' }).notNull().default(false),
	usualMin: integer('usual_min'), // how long it usually lasts, for estimates
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	// Set when a step with history is deleted: hidden everywhere, kept so past days stay intact.
	deletedAt: text('deleted_at')
});

export const occurrence = sqliteTable(
	'occurrence',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		templateId: integer('template_id').notNull().references(() => routineTemplate.id),
		localDate: text('local_date').notNull(),
		dayTypeId: integer('day_type_id').references(() => dayType.id),
		generatedAt: text('generated_at').notNull()
	},
	(t) => [uniqueIndex('occurrence_template_date').on(t.templateId, t.localDate)]
);

export const occurrenceStep = sqliteTable(
	'occurrence_step',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		occurrenceId: integer('occurrence_id').notNull().references(() => occurrence.id),
		stepId: integer('step_id').notNull().references(() => routineStep.id),
		titleSnapshot: text('title_snapshot').notNull(),
		iconSnapshot: text('icon_snapshot'),
		sortSnapshot: integer('sort_snapshot').notNull(),
		completedAt: text('completed_at'), // a timer step: when it started
		endedAt: text('ended_at'), // a timer step: when it stopped
		completedBy: text('completed_by', { enum: ['wall', 'board', 'planner', 'api'] })
	},
	(t) => [index('occurrence_step_occ').on(t.occurrenceId)]
);

export const completionEvent = sqliteTable(
	'completion_event',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		occurrenceStepId: integer('occurrence_step_id').notNull().references(() => occurrenceStep.id),
		// Plan steps: 'retime' corrects a tick's (or timer's start) time; timer steps add 'stop',
		// 'unstop' (undo a stop) and 'retime_end'.
		action: text('action', { enum: ['complete', 'uncomplete', 'retime', 'stop', 'unstop', 'retime_end'] }).notNull(),
		source: text('source', { enum: ['wall', 'board', 'planner', 'api'] }).notNull(),
		deviceId: text('device_id'),
		snapshotId: integer('snapshot_id'), // served snapshot the tap was applied against (wall only)
		slot: integer('slot'),
		eventTs: text('event_ts').notNull(),
		dedupeKey: text('dedupe_key').notNull()
	},
	(t) => [uniqueIndex('completion_event_dedupe').on(t.dedupeKey)]
);

export const device = sqliteTable('device', {
	id: text('id').primaryKey(), // Tesserae device id, or a sim id
	name: text('name').notNull(),
	tokenHash: text('token_hash').notNull(),
	lastSeen: text('last_seen'),
	settingsJson: text('settings_json').notNull().default('{}')
});

export const servedSnapshot = sqliteTable(
	'served_snapshot',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		deviceId: text('device_id').notNull().references(() => device.id),
		pageId: text('page_id').notNull(),
		renderedAt: text('rendered_at').notNull(),
		slotsJson: text('slots_json').notNull()
	},
	(t) => [index('served_snapshot_device_page').on(t.deviceId, t.pageId, t.id)]
);

export const setting = sqliteTable('setting', {
	key: text('key').primaryKey(),
	valueJson: text('value_json').notNull()
});

// Planner sessions (Stage 1: shared PIN). Token stored hashed.
export const plannerSession = sqliteTable('planner_session', {
	tokenHash: text('token_hash').primaryKey(),
	createdAt: text('created_at').notNull(),
	expiresAt: text('expires_at').notNull()
});

// Board screens (ADR-30): a browser paired once with a code from Planner → Settings. Token hashed.
export const boardSession = sqliteTable('board_session', {
	tokenHash: text('token_hash').primaryKey(),
	name: text('name').notNull(),
	createdAt: text('created_at').notNull(),
	lastSeenAt: text('last_seen_at').notNull()
});

// Shared lists (Stage 2): grocery, to-do, other. Household-wide, not per member.
export const list = sqliteTable('list', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	kind: text('kind', { enum: ['grocery', 'todo', 'other'] }).notNull(),
	icon: text('icon').notNull().default('bag'),
	sort: integer('sort').notNull().default(0),
	createdAt: text('created_at').notNull()
});

/** A shop on a shopping or other list (ADR-41). Items can be tied to one; the list filters by it. */
export const listShop = sqliteTable(
	'list_shop',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		listId: integer('list_id')
			.notNull()
			.references(() => list.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		tone: integer('tone').notNull(), // .tone-N, 0–4
		sort: integer('sort').notNull().default(0)
	},
	(t) => [index('list_shop_list').on(t.listId, t.sort)]
);

export const listItem = sqliteTable(
	'list_item',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		listId: integer('list_id')
			.notNull()
			.references(() => list.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		sort: integer('sort').notNull().default(0),
		createdAt: text('created_at').notNull(),
		doneAt: text('done_at'),
		doneBy: text('done_by', { enum: ['wall', 'board', 'planner'] }),
		// Optional due date and repeat (SPEC §5.1, ADR-24). A repeating item is never "done":
		// doing it logs a row in list_item_log and moves due_date on.
		dueDate: text('due_date'), // YYYY-MM-DD, household zone
		repeatEvery: integer('repeat_every'), // null = does not repeat
		repeatUnit: text('repeat_unit', { enum: ['day', 'week', 'month', 'year'] }),
		repeatMode: text('repeat_mode', { enum: ['after', 'fixed'] }),
		repeatAnchor: text('repeat_anchor'), // fixed schedules count from this date
		leadDays: integer('lead_days'), // null = automatic (10% of the interval, at most 30 days)
		// Flagged "Now": to pick up soon, with no date. When it was flagged (ISO); null = not flagged.
		nowSince: text('now_since'),
		// Free text: details, a link, a phone number. Shown under the title on the list (first line).
		notes: text('notes'),
		// Where to buy it (ADR-41): one of its list's shops, or null for any shop.
		shopId: integer('shop_id').references(() => listShop.id, { onDelete: 'set null' })
	},
	(t) => [index('list_item_list').on(t.listId, t.sort)]
);

/** Each time a repeating item was done or skipped. `due_before` restores the due date on undo. */
export const listItemLog = sqliteTable(
	'list_item_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		itemId: integer('item_id')
			.notNull()
			.references(() => listItem.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['done', 'skipped'] }).notNull(),
		doneOn: text('done_on').notNull(), // YYYY-MM-DD, may be backdated
		doneAt: text('done_at').notNull(), // when it was recorded
		doneBy: text('done_by', { enum: ['wall', 'board', 'planner'] }).notNull(),
		note: text('note'),
		dueBefore: text('due_before').notNull()
	},
	(t) => [index('list_item_log_item').on(t.itemId, t.id)]
);

// Gift ideas (SPEC §5.2, ADR-32): people kept all year, ideas added as they come up. Planner
// only; never read by the wall, the Board or the kid view.
// Names are unique ignoring case; checked in code (domain/gifts.ts), as member labels are.
export const giftPerson = sqliteTable('gift_person', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	birthday: text('birthday'), // MM-DD
	notes: text('notes'),
	createdAt: text('created_at').notNull()
});

export const giftIdea = sqliteTable(
	'gift_idea',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		personId: integer('person_id')
			.notNull()
			.references(() => giftPerson.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		notes: text('notes'),
		price: integer('price'), // whole dollars
		status: text('status', { enum: ['idea', 'bought', 'given'] }).notNull().default('idea'),
		occasion: text('occasion'), // "Christmas 2026"; set when bought if empty
		createdAt: text('created_at').notNull(),
		boughtAt: text('bought_at'),
		givenAt: text('given_at')
	},
	(t) => [index('gift_idea_person').on(t.personId, t.status)]
);

// Shared notes (SPEC §5.3, ADR-37): a heading and plain text, household-wide. `version` goes up
// on every save; a save names the version it started from, so two phones never overwrite each
// other without knowing.
export const note = sqliteTable('note', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull().default(''),
	body: text('body').notNull().default(''),
	version: integer('version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});
