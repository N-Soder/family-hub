import { z } from 'zod';
import type { DB } from './db';
import { getSetting, setSetting } from './settings';
import { localParts, DEFAULT_TZ } from './domain/time';

// Today's weather on the wall (ADR-26). Family Hub asks Open-Meteo (no key) for today's hourly
// and daily forecast every 30 minutes and keeps the last answer in memory; a render only reads
// that copy, so a tap never waits on the network. The place is chosen in Planner → Settings.

export const WEATHER_PLACE_KEY = 'weather_place';
export const WEATHER_REFRESH_MS = 30 * 60_000;
/** An answer older than this is not shown (the network has been down for a while). */
export const WEATHER_STALE_MS = 3 * 60 * 60_000;

export const placeSchema = z.object({
	name: z.string().trim().min(1).max(120),
	lat: z.coerce.number().min(-90).max(90),
	lon: z.coerce.number().min(-180).max(180)
});
export type WeatherPlace = z.infer<typeof placeSchema>;

export function weatherPlace(db: DB): WeatherPlace | null {
	const p = placeSchema.safeParse(getSetting<unknown>(db, WEATHER_PLACE_KEY, null));
	return p.success ? p.data : null;
}

export function setWeatherPlace(db: DB, place: WeatherPlace | null): void {
	setSetting(db, WEATHER_PLACE_KEY, place);
}

const series = () => z.array(z.number().nullable());
export const forecastSchema = z.object({
	hourly: z.object({
		time: z.array(z.string()),
		temperature_2m: series(),
		precipitation_probability: series(),
		weather_code: series(),
		wind_speed_10m: series(),
		wind_direction_10m: series(),
		is_day: series(),
		/** Added for the wall's blocks (ADR-36); optional so a forecast fetched before still parses. */
		uv_index: series().optional()
	}),
	daily: z.object({
		time: z.array(z.string()),
		temperature_2m_max: series(),
		temperature_2m_min: series(),
		uv_index_max: series().optional()
	})
});
export type Forecast = z.infer<typeof forecastSchema>;

type Fetch = typeof fetch;

export function forecastUrl(place: WeatherPlace, tz = DEFAULT_TZ): string {
	const q = new URLSearchParams({
		latitude: String(place.lat),
		longitude: String(place.lon),
		hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,is_day,uv_index',
		daily: 'temperature_2m_max,temperature_2m_min,uv_index_max',
		timezone: tz,
		forecast_days: '1'
	});
	return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export async function fetchForecast(place: WeatherPlace, tz = DEFAULT_TZ, f: Fetch = fetch): Promise<Forecast> {
	const res = await f(forecastUrl(place, tz), { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
	return forecastSchema.parse(await res.json());
}

const geoSchema = z.object({
	results: z
		.array(
			z.object({
				name: z.string(),
				latitude: z.number(),
				longitude: z.number(),
				admin1: z.string().optional(),
				country: z.string().optional(),
				timezone: z.string().optional()
			})
		)
		.optional()
});

/**
 * Places matching `query` (Open-Meteo geocoding), those in the household's time zone first
 * (Perth WA before Perth, Scotland), or a typed "lat, lon" pair as is.
 */
export async function findPlaces(query: string, tz = DEFAULT_TZ, f: Fetch = fetch): Promise<WeatherPlace[]> {
	const q = query.trim();
	const pair = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(q);
	if (pair) {
		const p = placeSchema.safeParse({ name: `${pair[1]}, ${pair[2]}`, lat: pair[1], lon: pair[2] });
		return p.success ? [p.data] : [];
	}
	const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '20', language: 'en', format: 'json' })}`;
	const res = await f(url, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Open-Meteo geocoding ${res.status}`);
	const { results = [] } = geoSchema.parse(await res.json());
	const home = (r: { timezone?: string }) => (r.timezone === tz ? 0 : 1);
	return [...results].sort((a, b) => home(a) - home(b)).slice(0, 6).map((r) => ({
		// A local place needs no country: "Perth, Western Australia".
		name: [r.name, r.admin1, home(r) ? r.country : null].filter((s, i, all) => s && all.indexOf(s) === i).join(', '),
		lat: Math.round(r.latitude * 1e4) / 1e4,
		lon: Math.round(r.longitude * 1e4) / 1e4
	}));
}

// ---------------------------------------------------------------------------------------------
// What the wall shows

export type WeatherIcon = 'wxSun' | 'wxMoon' | 'wxCloudSun' | 'wxCloudMoon' | 'wxCloud' | 'wxFog' | 'wxRain' | 'wxStorm';

export interface WallWind {
	/** Compass point the wind comes from ("E", "SW"). */
	from: string;
	/** Degrees the wind blows toward (the arrow's heading; 0 = up). */
	toward: number;
	kmh: number;
	/** 1 light (under 20 km/h), 2 moderate (20–34), 3 strong (35+). The wall shows this, not km/h. */
	level: Level;
	/** Mornings: when it turns, if it does before evening. `sea`: it turns to a S–W onshore wind (Perth's sea breeze). */
	change: { from: string; toward: number; kmh: number; level: Level; sea: boolean; at: string } | null;
}

export type Level = 1 | 2 | 3;

export interface WallWeather {
	icon: WeatherIcon;
	/** "Sunny", "Showers"… */
	label: string;
	temp: number;
	high: number | null;
	low: number | null;
	/** Today's peak UV index (rounded), or null when the forecast has none. */
	uv: number | null;
	/** 1 low (0–5), 2 high (6–10), 3 extreme (11+); null with `uv`. */
	uvLevel: Level | null;
	/** "Rain 60% from 3 pm", or null when it looks dry for the rest of the day (the Board shows this). */
	rain: string | null;
	/** The same for the wall: the chance, when it starts ("now", "from 3 pm") and a level
	 * (1 under 60%, 2 under 85%, 3 above); null when dry. */
	rainChance: { pct: number; when: string; level: Level } | null;
	wind: WallWind | null;
	/** The day in four blocks for the wall (ADR-36), or null when the forecast has no hours for them. */
	blocks: WallBlock[] | null;
}

/** One part of the day on the wall (ADR-36): the sky, a temperature, and chips for wind (always),
 * rain (30 %+) and UV (6+). */
export interface WallBlock {
	name: string;
	/** "6–9", "9–3"… */
	hours: string;
	icon: WeatherIcon;
	label: string;
	/** Morning: the block's low; the others: its high. */
	temp: number;
	/** The strongest hour: where it comes from and its level. */
	wind: { from: string; level: Level } | null;
	rain: { pct: number; level: Level } | null;
	uv: { index: number; level: Level } | null;
}

/** Morning, midday, arvo, evening (owner 2026-11-14): [first hour, end hour). */
export const BLOCKS: ReadonlyArray<{ name: string; from: number; to: number }> = [
	{ name: 'Morning', from: 6, to: 9 },
	{ name: 'Midday', from: 9, to: 15 },
	{ name: 'Arvo', from: 15, to: 18 },
	{ name: 'Evening', from: 18, to: 21 }
];

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const point = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const angle = (a: number, b: number) => {
	const d = Math.abs((((a - b) % 360) + 360) % 360);
	return d > 180 ? 360 - d : d;
};
/** Level thresholds for the wall's weather rows (owner 2026-11-11: a word and three bars, no km/h). */
export const windLevel = (kmh: number): Level => (kmh < 20 ? 1 : kmh < 35 ? 2 : 3);
export const uvLevel = (uv: number): Level => (uv < 6 ? 1 : uv < 11 ? 2 : 3);
export const rainLevel = (pct: number): Level => (pct < 60 ? 1 : pct < 85 ? 2 : 3);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

/** How bad a WMO code is, to pick a block's sky: storms over rain over snow over showers over fog over cloud. */
function severity(code: number): number {
	if (code >= 95) return 8;
	if ((code >= 61 && code <= 67) || code === 81 || code === 82) return 7;
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 6;
	if ((code >= 51 && code <= 57) || code === 80) return 5;
	if (code === 45 || code === 48) return 4;
	return Math.min(code, 3);
}

/** WMO weather code → icon and word. */
function condition(code: number, day: boolean): { icon: WeatherIcon; label: string } {
	if (code >= 95) return { icon: 'wxStorm', label: 'Storms' };
	if ((code >= 51 && code <= 57) || code === 80) return { icon: 'wxRain', label: 'Showers' };
	if ((code >= 61 && code <= 67) || code === 81 || code === 82) return { icon: 'wxRain', label: 'Rain' };
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'wxCloud', label: 'Snow' };
	if (code === 45 || code === 48) return { icon: 'wxFog', label: 'Fog' };
	if (code === 3) return { icon: 'wxCloud', label: 'Cloudy' };
	if (code === 2) return { icon: day ? 'wxCloudSun' : 'wxCloudMoon', label: 'Partly cloudy' };
	if (code === 1) return { icon: day ? 'wxSun' : 'wxMoon', label: day ? 'Mostly sunny' : 'Mostly clear' };
	return { icon: day ? 'wxSun' : 'wxMoon', label: day ? 'Sunny' : 'Clear' };
}

const RAIN_SHOWN = 30; // % chance before the wall mentions rain
const WIND_TURN = 60; // degrees that count as a change of wind
const MORNING_END = 12;
const WIND_LOOK_UNTIL = 18;

/** The wall's weather line for `now`, from today's forecast (null when it has no hour for now). */
export function summarise(fc: Forecast, now: Date, tz = DEFAULT_TZ): WallWeather | null {
	const { date, minutes } = localParts(now, tz);
	const hour = Math.floor(minutes / 60);
	const H = fc.hourly;
	const at = (h: number) => H.time.indexOf(`${date}T${String(h).padStart(2, '0')}:00`);
	const i = at(hour);
	if (i < 0) return null;
	const temp = H.temperature_2m[i];
	const code = H.weather_code[i];
	if (temp == null || code == null) return null;
	const d = fc.daily.time.indexOf(date);
	const round = (n: number | null | undefined) => (n == null ? null : Math.round(n));
	const uv = round(d >= 0 ? fc.daily.uv_index_max?.[d] : null);

	// Rain: the first hour from now with a fair chance, and the day's highest chance after it.
	let rain: string | null = null;
	let rainChance: WallWeather['rainChance'] = null;
	for (let h = hour; h < 24; h++) {
		const p = H.precipitation_probability[at(h)];
		if (p != null && p >= RAIN_SHOWN) {
			let max = p;
			for (let k = h; k < 24; k++) max = Math.max(max, H.precipitation_probability[at(k)] ?? 0);
			const pct = Math.round(max / 10) * 10;
			const when = h === hour ? 'now' : `from ${hourLabel(h)}`;
			rain = `Rain ${pct}% ${when}`;
			rainChance = { pct, when, level: rainLevel(pct) };
			break;
		}
	}

	// Wind: now, and in the morning when it turns (two hours in a row at least WIND_TURN° off).
	let wind: WallWind | null = null;
	const dir = H.wind_direction_10m[i];
	const kmh = H.wind_speed_10m[i];
	if (dir != null && kmh != null) {
		wind = { from: point(dir), toward: Math.round((dir + 180) % 360), kmh: Math.round(kmh), level: windLevel(Math.round(kmh)), change: null };
		if (hour < MORNING_END) {
			for (let h = hour + 1; h < WIND_LOOK_UNTIL; h++) {
				const a = H.wind_direction_10m[at(h)];
				const b = H.wind_direction_10m[at(h + 1)];
				if (a == null || b == null || angle(a, dir) < WIND_TURN || angle(b, dir) < WIND_TURN) continue;
				const s = Math.max(H.wind_speed_10m[at(h)] ?? 0, H.wind_speed_10m[at(h + 1)] ?? 0);
				const sea = ['S', 'SW', 'W'].includes(point(b));
				wind.change = { from: point(b), toward: Math.round((b + 180) % 360), kmh: Math.round(s), level: windLevel(Math.round(s)), sea, at: hourLabel(h) };
				break;
			}
		}
	}
	return {
		...condition(code, H.is_day[i] !== 0),
		blocks: blocks(fc, date),
		temp: Math.round(temp),
		high: round(d >= 0 ? fc.daily.temperature_2m_max[d] : null),
		low: round(d >= 0 ? fc.daily.temperature_2m_min[d] : null),
		uv,
		uvLevel: uv == null ? null : uvLevel(uv),
		rain,
		rainChance,
		wind
	};
}

/** The day in four blocks (ADR-36), whatever the time now: the wall paints once a day. */
export function blocks(fc: Forecast, date: string): WallBlock[] | null {
	const H = fc.hourly;
	const out: WallBlock[] = [];
	for (const b of BLOCKS) {
		const idx: number[] = [];
		for (let h = b.from; h < b.to; h++) {
			const k = H.time.indexOf(`${date}T${String(h).padStart(2, '0')}:00`);
			if (k >= 0 && H.temperature_2m[k] != null && H.weather_code[k] != null) idx.push(k);
		}
		if (!idx.length) return null;
		const temps = idx.map((k) => H.temperature_2m[k]!);
		const worst = idx.reduce((a, k) => (severity(H.weather_code[k]!) > severity(H.weather_code[a]!) ? k : a));
		const last = idx[idx.length - 1];
		let wind: WallBlock['wind'] = null;
		let strongest = -1;
		for (const k of idx) {
			const kmh = H.wind_speed_10m[k];
			const dir = H.wind_direction_10m[k];
			if (kmh != null && dir != null && kmh > strongest) {
				strongest = kmh;
				wind = { from: point(dir), level: windLevel(Math.round(kmh)) };
			}
		}
		const pmax = Math.max(...idx.map((k) => H.precipitation_probability[k] ?? 0));
		const pct = Math.round(pmax / 10) * 10;
		const uvs = idx.map((k) => H.uv_index?.[k]).filter((v): v is number => v != null);
		const uvi = uvs.length ? Math.round(Math.max(...uvs)) : null;
		out.push({
			name: b.name,
			hours: `${b.from % 12 || 12}–${b.to % 12 || 12}`,
			// Day or night from the block's last hour: a clear evening shows the moon.
			...condition(H.weather_code[worst]!, H.is_day[last] !== 0),
			temp: Math.round(b.from === BLOCKS[0].from ? Math.min(...temps) : Math.max(...temps)),
			wind,
			rain: pmax >= RAIN_SHOWN ? { pct, level: rainLevel(pct) } : null,
			uv: uvi != null && uvLevel(uvi) >= 2 ? { index: uvi, level: uvLevel(uvi) } : null
		});
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// The in-memory copy

export class WeatherCache {
	private last: { at: number; date: string; fc: Forecast; key: string } | null = null;
	private running: Promise<void> | null = null;

	constructor(private f: Fetch = fetch) {}

	/** Today's line for the wall, or null (no place, no answer yet, or the answer is stale). */
	get(now = new Date(), tz = DEFAULT_TZ): WallWeather | null {
		const l = this.last;
		if (!l || now.getTime() - l.at > WEATHER_STALE_MS) return null;
		return summarise(l.fc, now, tz);
	}

	/** Fetch again when the place changed, the date changed, or the copy is older than the refresh. */
	refresh(place: WeatherPlace | null, now = new Date(), tz = DEFAULT_TZ, force = false): Promise<void> {
		if (!place) {
			this.last = null;
			return Promise.resolve();
		}
		const key = `${place.lat},${place.lon}`;
		const date = localParts(now, tz).date;
		const l = this.last;
		if (!force && l && l.key === key && l.date === date && now.getTime() - l.at < WEATHER_REFRESH_MS) return Promise.resolve();
		this.running ??= fetchForecast(place, tz, this.f)
			.then((fc) => {
				this.last = { at: now.getTime(), date, fc, key };
			})
			.catch((e) => console.warn(`[weather] ${e instanceof Error ? e.message : e}`))
			.finally(() => (this.running = null));
		return this.running;
	}

	/** Tests and the sim: put a forecast in directly. */
	set(fc: Forecast | null, now = new Date(), tz = DEFAULT_TZ): void {
		this.last = fc ? { at: now.getTime(), date: localParts(now, tz).date, fc, key: 'set' } : null;
	}
}

const g = globalThis as unknown as { __familyHubWeather?: WeatherCache };
export const weatherCache: WeatherCache = (g.__familyHubWeather ??= new WeatherCache());
