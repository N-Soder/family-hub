import { z } from 'zod';
import { GLYPH_NAMES } from '$lib/glyphs';

// Zod schemas for every Planner form. Parse with `parseForm(schema, formData)`.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 h)');
const title = z.string().trim().min(1, 'Required').max(60, 'Keep it under 60 characters');
const glyph = z.enum(GLYPH_NAMES as [string, ...string[]]);
const id = z.coerce.number().int().positive();
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const memberForm = z.object({
	name: title,
	shortLabel: z
		.string()
		.trim()
		.min(2, '2–3 characters')
		.max(3, '2–3 characters')
		.transform((s) => s.toUpperCase()),
	kind: z.enum(['child', 'adult', 'baby']),
	icon: glyph,
	displayMode: z.enum(['picture', 'reader']),
	active: checkbox
});

export const dayTypeForm = z.object({ name: title, glyph });

/** One weekday of a member's weekly pattern; '' clears it. */
export const patternDayForm = z.object({
	memberId: id,
	weekday: z.coerce.number().int().min(0).max(6),
	dayTypeId: z.union([z.literal(''), id])
});

export const templateForm = z
	.object({
		name: title,
		kind: z.enum(['morning', 'after_school', 'bedtime', 'custom']),
		windowStart: time,
		windowEnd: time,
		days: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
		active: checkbox
	})
	.refine((t) => t.windowStart !== t.windowEnd, { message: 'Start and end must differ', path: ['windowEnd'] })
	.transform(({ days, ...t }) => ({ ...t, daysOfWeek: days.reduce((mask, d) => mask | (1 << d), 0) }));

export const daysMask = z.coerce.number().int().min(1).max(127);

export const stepForm = z.object({
	title,
	icon: glyph,
	dayTypes: z.array(id).default([]),
	active: checkbox
});

/** A baby's day plan (SPEC §12.3): just a name; the window is not used. */
export const planForm = z.object({ name: title, active: checkbox });

/**
 * When a plan step is due: no time, at a clock time, or N minutes after an earlier step.
 * Output is the three routine_step columns.
 */
/** A plan step's timer: off, or started and stopped, with how long it usually lasts. */
export const stepTimerForm = z.object({
	timer: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
	usualMin: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1, 'At least 1 minute').max(720, 'At most 12 hours').nullable())
});

export const stepWhenForm = z
	.discriminatedUnion('when', [
		z.object({ when: z.literal('none') }),
		z.object({ when: z.literal('at'), dueAt: time }),
		z.object({
			when: z.literal('after'),
			dueAfterStepId: id,
			dueAfterMin: z.coerce.number({ message: 'Minutes, 0 or more' }).int('Whole minutes').min(0, 'Minutes, 0 or more').max(720, 'At most 12 hours')
		})
	])
	.transform((w) => ({
		dueAt: w.when === 'at' ? w.dueAt : null,
		dueAfterStepId: w.when === 'after' ? w.dueAfterStepId : null,
		dueAfterMin: w.when === 'after' ? w.dueAfterMin : null
	}));

export const retimeForm = z.object({ stepId: id, time });

/** A plan timer: start, stop, undo a stop, or correct the stop ('end'); when = now, N min ago or HH:MM. */
export const timerForm = z.object({
	stepId: id,
	op: z.enum(['start', 'stop', 'unstop', 'end']),
	ago: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(720).optional()),
	time: z.preprocess((v) => (v === '' ? undefined : v), time.optional())
});

export const overrideForm = z.object({ memberId: id, dayTypeId: z.union([z.literal(''), id]) });
export const stepToggleForm = z.object({ stepId: id, done: z.enum(['1', '0']).transform((v) => v === '1') });
export const deviceForm = z.object({
	id: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,31}$/, 'Lowercase letters, digits, - or _; start with a letter'),
	name: title
});
export const pinForm = z
	.object({ current: z.string().max(12).default(''), pin: z.string().regex(/^\d{6,12}$/, '6–12 digits'), confirm: z.string() })
	.refine((p) => p.pin === p.confirm, { message: 'PINs do not match', path: ['confirm'] });
export const listForm = z.object({ name: title, kind: z.enum(['grocery', 'todo', 'other']), icon: glyph });
const itemTitle = z.string().trim().min(1, 'Type an item').max(80, 'Keep it under 80 characters');
export const itemForm = z.object({ title: itemTitle });
export const listIdForm = z.object({ listId: id });
export const newListForm = z.object({ name: title, kind: z.enum(['grocery', 'todo', 'other']) });
export const itemIdForm = z.object({ itemId: id });
export const itemToggleForm = z.object({ itemId: id, done: z.enum(['1', '0']).transform((v) => v === '1') });
export const itemRenameForm = z.object({ itemId: id, title: itemTitle });
export const loginForm = z.object({ pin: z.string().max(12) });
/** Board pairing (ADR-30): the six-digit code from Settings and what to call the screen. */
export const pairForm = z.object({
	code: z
		.string()
		.transform((s) => s.replace(/\s+/g, ''))
		.pipe(z.string().regex(/^\d{6}$/, 'Six digits')),
	name: z.string().trim().max(40).default('')
});
export const unpairForm = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) });

// Repeating list items (SPEC §5.1, ADR-24).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Pick a date');
const blankNull = (v: unknown) => (v === '' || v === undefined ? null : v);

/** The item page's main form: name, due date, repeat and lead time. Output fits `setSchedule`. */
export const itemScheduleForm = z
	.object({
		itemId: id,
		title: itemTitle,
		due: z.preprocess(blankNull, isoDate.nullable()),
		/** Details, links, anything: up to 2,000 characters; blank = none. */
		notes: z.preprocess(blankNull, z.string().trim().max(2000, 'Keep notes under 2,000 characters').nullable()).default(null),
		// Shopping items post only name and notes: no date, no repeat.
		repeat: z.enum(['none', 'after', 'fixed']).default('none'),
		/** Without a repeat: no date, Now (soon, no date) or by a date. */
		when: z.enum(['none', 'now', 'date']).default('none'),
		every: z.coerce.number({ message: 'A number, 1 or more' }).int('Whole numbers').min(1, 'At least 1').max(99, 'At most 99').default(1),
		unit: z.enum(['day', 'week', 'month', 'year']).default('month'),
		/** '' = automatic. */
		lead: z.preprocess(blankNull, z.coerce.number({ message: 'Days, 0 or more' }).int('Whole days').min(0, 'Days, 0 or more').max(365, 'At most 365').nullable())
	})
	.refine((f) => f.repeat !== 'none' || f.when !== 'date' || f.due, { path: ['due'], message: 'Pick a date' })
	.transform((f) => {
		const oneOff = f.repeat === 'none';
		return {
			itemId: f.itemId,
			title: f.title,
			notes: f.notes,
			schedule: {
				due: oneOff && f.when !== 'date' ? null : f.due,
				repeat: f.repeat === 'none' ? null : { every: f.every, unit: f.unit, mode: f.repeat },
				leadDays: oneOff && f.when !== 'date' ? null : f.lead,
				now: oneOff && f.when === 'now'
			}
		};
	});

/** Flag or unflag an item Now from the list. */
export const nowForm = z.object({ itemId: id, now: z.enum(['0', '1']).transform((v) => v === '1') });

/** Done on a chosen date (not in the future), with an optional note. */
export const itemDoneForm = z.object({
	itemId: id,
	doneOn: isoDate,
	note: z.preprocess(blankNull, z.string().trim().max(200, 'Keep it under 200 characters').nullable())
});
export const snoozeForm = z.object({ itemId: id, days: z.coerce.number().int().min(1).max(365) });
export const logIdForm = z.object({ logId: id });
export const suggestForm = z.object({ listId: id, key: z.string().max(40) });

// Gift ideas (SPEC §5.2, ADR-32).
const giftStatus = z.enum(['idea', 'bought', 'given']);
const giftNotes = z.preprocess(blankNull, z.string().trim().max(2000, 'Keep notes under 2,000 characters').nullable()).default(null);
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const giftPersonIdForm = z.object({ personId: id });
export const giftNewPersonForm = z.object({ name: title });
/** Name, birthday (day + month, no year; both or neither) and notes. Birthday comes out MM-DD. */
export const giftPersonForm = z
	.object({
		personId: id,
		name: title,
		day: z.preprocess(blankNull, z.coerce.number().int().min(1).max(31).nullable()).default(null),
		month: z.preprocess(blankNull, z.coerce.number().int().min(1).max(12).nullable()).default(null),
		notes: giftNotes
	})
	.refine((f) => (f.day === null) === (f.month === null), { path: ['day'], message: 'Pick a day and a month, or neither' })
	.refine((f) => f.day === null || f.month === null || f.day <= DAYS_IN[f.month - 1], { path: ['day'], message: 'That month is shorter' })
	.transform((f) => ({
		personId: f.personId,
		name: f.name,
		notes: f.notes,
		birthday: f.day && f.month ? `${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}` : null
	}));
export const giftAddIdeaForm = z.object({ personId: id, title: itemTitle });
export const giftIdeaIdForm = z.object({ ideaId: id });
export const giftStatusForm = z.object({ ideaId: id, status: giftStatus });
export const giftIdeaForm = z.object({
	ideaId: id,
	title: itemTitle,
	notes: giftNotes,
	/** Whole dollars; "$40" and "1,200" are fine. Blank = none. */
	price: z.preprocess(
		(v) => (typeof v === 'string' ? blankNull(v.replace(/[$,\s]/g, '')) : blankNull(v)),
		z.coerce.number({ message: 'A number of dollars' }).min(0, 'A number of dollars').max(100000, 'At most $100,000').transform(Math.round).nullable()
	),
	occasion: z.preprocess(blankNull, z.string().trim().max(40, 'Keep it under 40 characters').nullable()),
	status: giftStatus
});
export const giftOccasionForm = z.object({ occasion: z.string().trim().min(1).max(40) });

/** FormData → object (repeated keys become arrays for array fields) → schema. */
export function parseForm<S extends z.ZodType>(schema: S, form: FormData, arrays: string[] = []) {
	const obj: Record<string, unknown> = {};
	for (const key of new Set(form.keys())) {
		const all = form.getAll(key).map((v) => (typeof v === 'string' ? v : ''));
		obj[key] = arrays.includes(key) ? all : all[0];
	}
	for (const key of arrays) obj[key] ??= [];
	return schema.safeParse(obj) as z.ZodSafeParseResult<z.output<S>>;
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
	const out: Record<string, string> = {};
	for (const issue of error.issues) out[String(issue.path[0] ?? 'form')] ??= issue.message;
	return out;
}

/**
 * A note save (JSON, PUT /planner/notes/[id]). The heading is trimmed; the text keeps its
 * spacing, with Windows line endings made plain.
 */
export const noteSave = z.object({
	title: z.string().trim().max(80, 'Keep the heading under 80 characters'),
	body: z
		.string()
		.transform((s) => s.replace(/\r\n?/g, '\n'))
		.pipe(z.string().max(20_000, 'Notes can be up to 20,000 characters')),
	version: z.number().int().positive()
});
