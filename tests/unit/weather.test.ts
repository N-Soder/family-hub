import { describe, expect, it, vi } from 'vitest';
import { perth } from '../helpers';
import { blocks, findPlaces, rainLevel, summarise, uvLevel, WeatherCache, WEATHER_STALE_MS, windLevel, type Forecast } from '../../src/lib/server/weather';

// Today's weather on the wall (ADR-26): Family Hub works out what the band says.

const DAY = '2026-11-02';
/** A Perth summer day: easterly morning, the sea breeze (SW) from 1 pm, showers late. */
function forecast(over: Partial<Record<keyof Forecast['hourly'], (h: number) => number | null>> = {}): Forecast {
	const hours = Array.from({ length: 24 }, (_, h) => h);
	const col = (k: keyof Forecast['hourly'], f: (h: number) => number | null) => hours.map((h) => (over[k] ?? f)(h));
	return {
		hourly: {
			time: hours.map((h) => `${DAY}T${String(h).padStart(2, '0')}:00`),
			temperature_2m: col('temperature_2m', (h) => 16 + Math.min(h, 14)),
			precipitation_probability: col('precipitation_probability', (h) => (h >= 15 ? 60 : 5)),
			weather_code: col('weather_code', (h) => (h >= 15 ? 80 : 0)),
			wind_speed_10m: col('wind_speed_10m', (h) => (h < 13 ? 18 : 25)),
			wind_direction_10m: col('wind_direction_10m', (h) => (h < 13 ? 90 : 225)),
			is_day: col('is_day', (h) => (h >= 6 && h < 19 ? 1 : 0)),
			// UV climbs to 11 at 1 pm and falls away by evening.
			uv_index: col('uv_index', (h) => Math.max(0, 11.2 - Math.abs(h - 13) * 1.6))
		},
		daily: { time: [DAY], temperature_2m_max: [31.4], temperature_2m_min: [15.6], uv_index_max: [11.35] }
	} as Forecast;
}

describe('summarise', () => {
	it('mornings: the wind now and when the sea breeze turns it', () => {
		expect(summarise(forecast(), perth(DAY, '07:20'))).toEqual({
			icon: 'wxSun',
			label: 'Sunny',
			temp: 23,
			high: 31,
			low: 16,
			uv: 11,
			uvLevel: 3,
			rain: 'Rain 60% from 3 pm',
			rainChance: { pct: 60, when: 'from 3 pm', level: 2 },
			wind: { from: 'E', toward: 270, kmh: 18, level: 1, change: { from: 'SW', toward: 45, kmh: 25, level: 2, sea: true, at: '1 pm' } },
			blocks: expect.any(Array)
		});
	});

	it('levels for the wall: wind, rain and UV as 1–3, not km/h', () => {
		expect([0, 19, 20, 34, 35, 80].map(windLevel)).toEqual([1, 1, 2, 2, 3, 3]);
		expect([30, 59, 60, 84, 85, 100].map(rainLevel)).toEqual([1, 1, 2, 2, 3, 3]);
		expect([0, 5, 6, 10, 11, 14].map(uvLevel)).toEqual([1, 1, 2, 2, 3, 3]);
	});

	it('a change to an easterly is not a sea breeze', () => {
		const offshore = forecast({ wind_direction_10m: (h) => (h < 13 ? 225 : 90), wind_speed_10m: (h) => (h < 13 ? 10 : 40) });
		expect(summarise(offshore, perth(DAY, '07:20'))!.wind!.change).toMatchObject({ from: 'E', level: 3, sea: false });
	});

	it('after noon: the wind now only; rain already on says "now"', () => {
		const w = summarise(forecast(), perth(DAY, '15:10'))!;
		expect(w.wind).toEqual({ from: 'SW', toward: 45, kmh: 25, level: 2, change: null });
		expect(w).toMatchObject({ icon: 'wxRain', label: 'Showers', rain: 'Rain 60% now', rainChance: { pct: 60, when: 'now', level: 2 } });
	});

	it('a wobble is not a change; two hours in a row 60° off is', () => {
		const wobble = forecast({ wind_direction_10m: (h) => (h === 10 ? 200 : 90) });
		expect(summarise(wobble, perth(DAY, '07:00'))!.wind!.change).toBeNull();
	});

	it('a dry day says nothing about rain; night icons after dark', () => {
		const dry = forecast({ precipitation_probability: () => 10, weather_code: () => 2 });
		expect(summarise(dry, perth(DAY, '21:00'))).toMatchObject({ rain: null, rainChance: null, icon: 'wxCloudMoon', label: 'Partly cloudy' });
	});

	it('no UV in the forecast → uv null', () => {
		const fc = forecast();
		delete fc.daily.uv_index_max;
		expect(summarise(fc, perth(DAY, '07:20'))).toMatchObject({ uv: null, uvLevel: null });
	});

	it("no hour for now (yesterday's forecast) → nothing", () => {
		expect(summarise(forecast(), perth('2026-11-03', '07:00'))).toBeNull();
	});
});

describe('blocks (ADR-36)', () => {
	it('the day in four blocks: worst sky, morning low / later highs, strongest wind, rain 30 %+, UV 6+', () => {
		expect(blocks(forecast(), DAY)).toEqual([
			{ name: 'Morning', hours: '6–9', icon: 'wxSun', label: 'Sunny', temp: 22, wind: { from: 'E', level: 1 }, rain: null, uv: null },
			{ name: 'Midday', hours: '9–3', icon: 'wxSun', label: 'Sunny', temp: 30, wind: { from: 'SW', level: 2 }, rain: null, uv: { index: 11, level: 3 } },
			{ name: 'Arvo', hours: '3–6', icon: 'wxRain', label: 'Showers', temp: 30, wind: { from: 'SW', level: 2 }, rain: { pct: 60, level: 2 }, uv: { index: 8, level: 2 } },
			{ name: 'Evening', hours: '6–9', icon: 'wxRain', label: 'Showers', temp: 30, wind: { from: 'SW', level: 2 }, rain: { pct: 60, level: 2 }, uv: null }
		]);
	});

	it('the same whatever the time now: the wall paints once a day', () => {
		expect(summarise(forecast(), perth(DAY, '06:15'))!.blocks).toEqual(summarise(forecast(), perth(DAY, '19:30'))!.blocks);
	});

	it('a clear evening shows the moon; a stormy hour makes the whole block stormy', () => {
		const fc = forecast({ weather_code: (h) => (h === 10 ? 95 : 0) });
		const b = blocks(fc, DAY)!;
		expect(b[1]).toMatchObject({ icon: 'wxStorm', label: 'Storms' });
		expect(b[3]).toMatchObject({ icon: 'wxMoon', label: 'Clear' });
	});

	it('no hourly UV (an older forecast) → no UV chips; missing hours → no blocks', () => {
		const fc = forecast();
		delete fc.hourly.uv_index;
		expect(blocks(fc, DAY)!.every((b) => b.uv === null)).toBe(true);
		expect(blocks(forecast(), '2026-11-03')).toBeNull();
	});
});

describe('findPlaces', () => {
	const geo = (results: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ results })));

	it('puts places in the household time zone first, without their country', async () => {
		const f = geo([
			{ name: 'Perth', latitude: 56.39522, longitude: -3.43139, admin1: 'Scotland', country: 'United Kingdom', timezone: 'Europe/London' },
			{ name: 'Perth', latitude: -31.95224, longitude: 115.8614, admin1: 'Western Australia', country: 'Australia', timezone: 'Australia/Perth' }
		]);
		expect(await findPlaces('Perth', 'Australia/Perth', f)).toEqual([
			{ name: 'Perth, Western Australia', lat: -31.9522, lon: 115.8614 },
			{ name: 'Perth, Scotland, United Kingdom', lat: 56.3952, lon: -3.4314 }
		]);
	});

	it('takes a typed "lat, lon" as is, without asking', async () => {
		const f = geo([]);
		expect(await findPlaces('-31.9, 115.86', 'Australia/Perth', f)).toEqual([{ name: '-31.9, 115.86', lat: -31.9, lon: 115.86 }]);
		expect(f).not.toHaveBeenCalled();
	});
});

describe('WeatherCache', () => {
	const place = { name: 'Home', lat: -31.9, lon: 115.86 };
	const NOW = perth(DAY, '07:00');

	it('fetches once per 30 minutes, again for a new place, and hides a stale copy', async () => {
		const f = vi.fn(async () => new Response(JSON.stringify(forecast())));
		const c = new WeatherCache(f as unknown as typeof fetch);
		expect(c.get(NOW)).toBeNull();
		await c.refresh(place, NOW);
		await c.refresh(place, new Date(NOW.getTime() + 10 * 60_000));
		expect(f).toHaveBeenCalledTimes(1);
		expect(c.get(NOW)?.temp).toBe(23);
		await c.refresh({ ...place, lat: -32 }, NOW);
		expect(f).toHaveBeenCalledTimes(2);
		expect(c.get(new Date(NOW.getTime() + WEATHER_STALE_MS + 1))).toBeNull();
		await c.refresh(null, NOW);
		expect(c.get(NOW)).toBeNull();
	});

	it('keeps the last answer when Open-Meteo fails', async () => {
		let ok = true;
		const f = vi.fn(async () => (ok ? new Response(JSON.stringify(forecast())) : new Response('down', { status: 503 })));
		const c = new WeatherCache(f as unknown as typeof fetch);
		await c.refresh(place, NOW);
		ok = false;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await c.refresh(place, new Date(NOW.getTime() + 31 * 60_000));
		expect(warn).toHaveBeenCalled();
		expect(c.get(new Date(NOW.getTime() + 31 * 60_000))?.temp).toBe(23);
		warn.mockRestore();
	});
});
