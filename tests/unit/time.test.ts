import { describe, expect, it } from 'vitest';
import { displayDate, localParts, addDays, hhmm } from '../../src/lib/server/domain/time';
import { activeRunDate, selectActive, selectNext } from '../../src/lib/server/domain/windows';
import { perth } from '../helpers';

const t = (start: string, end: string, days = 127) => ({ id: 1, windowStart: start, windowEnd: end, daysOfWeek: days, active: true });

describe('Perth local time', () => {
	it('uses the Perth calendar date, not UTC', () => {
		// 06:30 Perth on the 26th is still the 25th in UTC.
		const p = localParts(perth('2026-10-26', '06:30'));
		expect(p.date).toBe('2026-10-26');
		expect(p.minutes).toBe(6 * 60 + 30);
		expect(p.weekday).toBe(1); // Monday
	});
	it('rolls the display date over at 03:00', () => {
		expect(displayDate(perth('2026-10-26', '02:59'))).toBe('2026-10-25');
		expect(displayDate(perth('2026-10-26', '03:00'))).toBe('2026-10-26');
	});
	it('parses and rejects HH:MM', () => {
		expect(hhmm('19:05')).toBe(1145);
		expect(() => hhmm('24:00')).toThrow();
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});
});

describe('routine windows', () => {
	it('a midnight-crossing window belongs to the date it starts', () => {
		const bed = t('19:00', '01:00');
		expect(activeRunDate(bed, perth('2026-10-26', '20:00'))).toBe('2026-10-26');
		expect(activeRunDate(bed, perth('2026-10-27', '00:30'))).toBe('2026-10-26');
		expect(activeRunDate(bed, perth('2026-10-27', '01:00'))).toBeNull();
		expect(activeRunDate(bed, perth('2026-10-26', '18:59'))).toBeNull();
	});
	it('honours the day-of-week mask on the start date', () => {
		const weekdaysOnly = t('06:30', '09:00', 0b0111110); // Mon–Fri
		expect(activeRunDate(weekdaysOnly, perth('2026-10-26', '07:00'))).toBe('2026-10-26'); // Mon
		expect(activeRunDate(weekdaysOnly, perth('2026-10-25', '07:00'))).toBeNull(); // Sun
		const satNight = t('19:00', '01:00', 1 << 6); // Saturday only
		expect(activeRunDate(satNight, perth('2026-10-25', '00:30'))).toBe('2026-10-24'); // Sun 00:30 → Sat run
	});
	it('selects the running routine, and none outside every window', () => {
		const list = [{ ...t('06:30', '09:00'), id: 1 }, { ...t('18:30', '21:00'), id: 2 }];
		expect(selectActive(list, perth('2026-10-26', '07:00'))?.template.id).toBe(1);
		expect(selectActive(list, perth('2026-10-26', '19:00'))?.template.id).toBe(2);
		expect(selectActive(list, perth('2026-10-26', '12:00'))).toBeNull();
		expect(selectNext(list, perth('2026-10-26', '12:00'))?.id).toBe(2);
		expect(selectNext(list, perth('2026-10-26', '22:00'))).toBeNull();
	});
	it('ignores inactive templates', () => {
		expect(activeRunDate({ ...t('00:00', '23:59'), active: false }, perth('2026-10-26', '07:00'))).toBeNull();
	});
});
