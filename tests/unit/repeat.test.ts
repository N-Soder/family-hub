import { describe, expect, it } from 'vitest';
import {
	addInterval,
	autoLeadDays,
	averageGap,
	dueLabel,
	dueState,
	nextDue,
	nextOnSchedule,
	progress,
	repeatLabel,
	skipDue,
	wallDueLabel,
	type Repeat
} from '../../src/lib/server/domain/repeat';

const after = (every: number, unit: Repeat['unit'], anchor = '2026-01-01'): Repeat => ({ every, unit, mode: 'after', anchor });
const fixed = (every: number, unit: Repeat['unit'], anchor: string): Repeat => ({ every, unit, mode: 'fixed', anchor });

describe('adding an interval', () => {
	it('days and weeks are plain calendar days', () => {
		expect(addInterval('2026-11-02', 3, 'day')).toBe('2026-11-05');
		expect(addInterval('2026-12-29', 1, 'week')).toBe('2027-01-05');
	});
	it('months keep the day, or use the last day of a shorter month', () => {
		expect(addInterval('2026-01-31', 1, 'month')).toBe('2026-02-28');
		expect(addInterval('2028-01-31', 1, 'month')).toBe('2028-02-29');
		expect(addInterval('2026-03-15', 12, 'month')).toBe('2027-03-15');
		expect(addInterval('2026-11-30', 3, 'month')).toBe('2027-02-28');
	});
	it('years from 29 Feb land on 28 Feb', () => {
		expect(addInterval('2028-02-29', 1, 'year')).toBe('2029-02-28');
	});
});

describe('lead time (when it starts showing)', () => {
	it('is a tenth of the interval, 0–30 days', () => {
		expect(autoLeadDays(1, 'day')).toBe(0);
		expect(autoLeadDays(1, 'week')).toBe(1);
		expect(autoLeadDays(1, 'month')).toBe(3);
		expect(autoLeadDays(3, 'month')).toBe(9);
		expect(autoLeadDays(6, 'month')).toBe(18);
		expect(autoLeadDays(12, 'month')).toBe(30);
		expect(autoLeadDays(1, 'year')).toBe(30);
		expect(autoLeadDays(5, 'year')).toBe(30);
	});
});

describe('the next due date', () => {
	it('after done: one interval from the day it was done, early, late or backdated', () => {
		const car = after(12, 'month');
		expect(nextDue(car, '2026-11-01', '2026-11-01')).toBe('2027-11-01');
		expect(nextDue(car, '2026-11-01', '2026-12-10')).toBe('2027-12-10'); // a month late
		expect(nextDue(car, '2026-11-01', '2026-10-20')).toBe('2027-10-20'); // early / backdated
	});

	it('fixed: stays on the schedule however late it is done', () => {
		const bins = fixed(1, 'week', '2026-10-29'); // Thursdays
		expect(nextDue(bins, '2026-11-05', '2026-11-05')).toBe('2026-11-12');
		expect(nextDue(bins, '2026-11-05', '2026-11-07')).toBe('2026-11-12'); // two days late
		expect(nextDue(bins, '2026-11-05', '2026-11-26')).toBe('2026-12-03'); // three weeks missed
	});

	it('fixed: doing it early does not make it due again straight away', () => {
		const bins = fixed(1, 'week', '2026-10-29');
		expect(nextDue(bins, '2026-11-05', '2026-11-04')).toBe('2026-11-12');
	});

	it('fixed monthly on the 31st never drifts to the 28th', () => {
		const rent = fixed(1, 'month', '2026-01-31');
		expect(nextDue(rent, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
		expect(nextDue(rent, '2026-02-28', '2026-02-28')).toBe('2026-03-31');
		expect(nextOnSchedule(rent, '2026-03-31')).toBe('2026-04-30');
	});

	it('fixed yearly renewals', () => {
		const rego = fixed(1, 'year', '2026-03-14');
		expect(nextDue(rego, '2027-03-14', '2027-03-01')).toBe('2028-03-14');
	});

	it('skipping moves to the next date without counting from today', () => {
		expect(skipDue(fixed(1, 'week', '2026-10-29'), '2026-11-05')).toBe('2026-11-12');
		expect(skipDue(after(3, 'month'), '2026-11-05')).toBe('2027-02-05');
	});
});

describe('due states and labels', () => {
	const today = '2026-11-02';
	it('overdue, today, soon (inside the lead time) and later', () => {
		expect(dueState('2026-10-28', today, 30)).toBe('overdue');
		expect(dueState(today, today, 30)).toBe('today');
		expect(dueState('2026-11-14', today, 30)).toBe('soon');
		expect(dueState('2026-12-02', today, 30)).toBe('soon');
		expect(dueState('2026-12-03', today, 30)).toBe('later');
		expect(dueState('2026-11-03', today, 0)).toBe('later');
	});
	it('reads well on a phone and on the wall', () => {
		expect(dueLabel('2026-10-28', today, 'overdue')).toBe('5 days overdue');
		expect(dueLabel('2026-10-12', today, 'overdue')).toBe('3 weeks overdue');
		expect(dueLabel(today, today, 'today')).toBe('Due today');
		expect(dueLabel('2026-11-03', today, 'soon')).toBe('Due tomorrow');
		expect(dueLabel('2026-11-14', today, 'soon')).toBe('Due in 12 days');
		expect(dueLabel('2026-12-25', today, 'later')).toBe('Due 25 Dec');
		expect(dueLabel('2027-11-02', today, 'later')).toBe('Due 2 Nov 2027');
		expect(wallDueLabel('2026-11-01', today, 'overdue')).toBe('1 day late');
		expect(wallDueLabel('2026-11-14', today, 'soon')).toBe('In 12 days');
	});
	it('progress fills through the interval', () => {
		expect(progress('2027-11-02', today, 12, 'month')).toBeCloseTo(0, 2);
		expect(progress(today, today, 12, 'month')).toBe(1);
		expect(progress('2026-10-01', today, 12, 'month')).toBe(1);
		expect(progress('2026-11-09', today, 2, 'week')).toBe(0.5);
	});
	it('describes the repeat and the history', () => {
		expect(repeatLabel({ every: 12, unit: 'month', mode: 'after' })).toBe('Every 12 months');
		expect(repeatLabel({ every: 1, unit: 'week', mode: 'fixed' })).toBe('Every week, fixed');
		expect(averageGap(['2024-11-01', '2025-11-20', '2026-11-01'], 'month')).toBe('about 12 months apart');
		expect(averageGap(['2026-11-01'], 'month')).toBeNull();
	});
});
