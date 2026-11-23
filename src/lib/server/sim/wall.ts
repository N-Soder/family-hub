import { publish } from '../events';
import type { ManifestRegion } from '../tesserae/client';
import { encodeGrayPng } from './png';

// A fake always-on reTerminal E1003 living inside the app, so /sim shows what
// the glass would show without hardware. It speaks the REST device protocol:
// polls /frame/data every second while someone is watching (the linger poll),
// downloads full frames, applies patch rects to its own framebuffer exactly as
// the firmware does (memcpy per rect), and reports taps by region id.

const WIRE_W = 1872; // native landscape
const WIRE_H = 1404;
export const COMP_W = 1404; // portrait composition
export const COMP_H = 1872;
const ROW_BYTES = WIRE_W / 2; // 4 bpp

/** wire rect → portrait rect (inverse of Tesserae's rotate-cw for rotation 90). */
export function wireToComp(r: { x: number; y: number; w: number; h: number }) {
	return { x: r.y, y: COMP_H - (r.x + r.w), w: r.h, h: r.w };
}

export interface SimStats {
	connected: boolean;
	digest: string;
	patchSeq: number;
	frames: number;
	patches: number;
	lastLatencyMs: number | null; // tap → first change on glass
	lastSettledMs: number | null; // tap → last change within 6 s (full-frame repaints land after a patch)
	latencies: number[];
	settled: number[];
	error: string | null;
}

export class SimWall {
	private fb = new Uint8Array(WIRE_W * WIRE_H / 2); // packed 4bpp, as on the device
	private digest = '';
	private patchSeq = 0;
	private eventId = Math.floor(Date.now() / 1000);
	private regions: ManifestRegion[] = [];
	private png: { key: string; buf: Buffer } | null = null;
	private version = 0;
	private lastWatch = 0;
	private pendingTap: number | null = null;
	private lastTap: number | null = null;
	private timer: NodeJS.Timeout | null = null;
	readonly stats: SimStats = {
		connected: false,
		digest: '',
		patchSeq: 0,
		frames: 0,
		patches: 0,
		lastLatencyMs: null,
		lastSettledMs: null,
		latencies: [],
		settled: [],
		error: null
	};

	constructor(
		private base: string,
		readonly id: string,
		private token: string
	) {}

	private headers(extra: Record<string, string> = {}) {
		return { authorization: `Bearer ${this.token}`, ...extra };
	}

	private abs(u: string): string {
		const parsed = new URL(u, this.base);
		return `${this.base}${parsed.pathname}${parsed.search}`;
	}

	/** Mark that a viewer is watching: poll at 1 s for the next two minutes. */
	watch(): void {
		this.lastWatch = Date.now();
		if (!this.timer) this.schedule(0);
	}

	start(): void {
		this.schedule(0);
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule(ms: number): void {
		this.timer = setTimeout(() => void this.loop(), ms);
	}

	private async loop(): Promise<void> {
		try {
			await this.poll();
			this.stats.connected = true;
			this.stats.error = null;
		} catch (e) {
			this.stats.connected = false;
			this.stats.error = e instanceof Error ? e.message : String(e);
		}
		const active = Date.now() - this.lastWatch < 120_000 || this.pendingTap !== null;
		this.schedule(active ? 1000 : 10_000);
	}

	async poll(): Promise<void> {
		if (!this.digest) {
			await this.fetchFrame();
			return;
		}
		const res = await fetch(`${this.base}/api/v1/device/${this.id}/frame/data?digest=${this.digest}`, { headers: this.headers() });
		if (res.status === 404) {
			await res.arrayBuffer();
			await this.fetchFrame();
			return;
		}
		if (!res.ok) throw new Error(`frame/data ${res.status}`);
		const j = (await res.json()) as {
			stale?: boolean;
			patches?: { seq: number; url: string; frame_digest: string; rects: Array<{ x: number; y: number; w: number; h: number; offset: number; len: number }> };
		};
		if (j.stale) {
			await this.fetchFrame();
			return;
		}
		if (j.patches && j.patches.seq > this.patchSeq && j.patches.frame_digest === this.digest) {
			const blob = new Uint8Array(await (await fetch(this.abs(j.patches.url), { headers: this.headers() })).arrayBuffer());
			for (const r of j.patches.rects) {
				const bytesPerRow = r.w / 2;
				for (let row = 0; row < r.h; row++) {
					const src = r.offset + row * bytesPerRow;
					this.fb.set(blob.subarray(src, src + bytesPerRow), (r.y + row) * ROW_BYTES + r.x / 2);
				}
			}
			this.patchSeq = j.patches.seq;
			this.stats.patches++;
			this.changed('patch');
		}
	}

	private async fetchFrame(): Promise<void> {
		const res = await fetch(`${this.base}/api/v1/device/${this.id}/frame`, {
			headers: this.headers(this.digest ? { 'if-none-match': `"${this.digest}"` } : {})
		});
		if (res.status !== 200) {
			await res.arrayBuffer();
			if (res.status === 304 || res.status === 204) return;
			throw new Error(`frame ${res.status}`);
		}
		const j = (await res.json()) as { url: string; render_id: string };
		const bin = new Uint8Array(await (await fetch(this.abs(j.url), { headers: this.headers() })).arrayBuffer());
		if (bin.length !== this.fb.length) throw new Error(`unexpected frame size ${bin.length}`);
		this.fb.set(bin);
		this.digest = j.render_id;
		this.patchSeq = 0;
		this.stats.frames++;
		const m = await fetch(`${this.base}/api/v1/device/${this.id}/frame/manifest?digest=${this.digest}`, { headers: this.headers() });
		this.regions = m.ok ? (((await m.json()) as { regions?: ManifestRegion[] }).regions ?? []) : [];
		this.changed('full');
	}

	private changed(kind: 'patch' | 'full'): void {
		this.version++;
		this.stats.digest = this.digest;
		this.stats.patchSeq = this.patchSeq;
		let latencyMs: number | undefined;
		if (this.pendingTap !== null) {
			latencyMs = Date.now() - this.pendingTap;
			this.pendingTap = null;
			this.stats.lastLatencyMs = latencyMs;
			this.stats.latencies = [...this.stats.latencies.slice(-49), latencyMs];
		}
		if (this.lastTap !== null && Date.now() - this.lastTap < 6000) {
			const settled = Date.now() - this.lastTap;
			if (latencyMs !== undefined) this.stats.settled = [...this.stats.settled.slice(-49), settled];
			else this.stats.settled[this.stats.settled.length - 1] = settled;
			this.stats.lastSettledMs = settled;
		}
		publish({ type: 'frame', deviceId: this.id, seq: this.version, latencyMs, kind });
	}

	/** Tap regions in portrait coordinates (what the overlay needs). */
	tapRegions(): Array<{ id: string; x: number; y: number; w: number; h: number }> {
		return this.regions.filter((r) => r.gestures && 'tap' in r.gestures).map((r) => ({ id: r.id, ...wireToComp(r.rect) }));
	}

	async tap(regionId: string): Promise<{ outcome: string }> {
		this.watch();
		const res = await fetch(`${this.base}/api/v1/device/${this.id}/tap`, {
			method: 'POST',
			headers: this.headers({ 'content-type': 'application/json' }),
			body: JSON.stringify({ digest: this.digest, region_id: regionId, gesture: 'tap', event_id: ++this.eventId })
		});
		const out = (await res.json()) as { outcome: string };
		if (out.outcome === 'ok') this.pendingTap = this.lastTap = Date.now();
		return out;
	}

	/** Current glass as a portrait PNG (cached per framebuffer version). */
	snapshotPng(): Buffer {
		const key = `${this.digest}:${this.version}`;
		if (this.png?.key === key) return this.png.buf;
		const out = new Uint8Array(COMP_W * COMP_H);
		for (let X = 0; X < WIRE_W; X++) {
			const shift = X % 2 === 0 ? 4 : 0;
			const byteCol = X >> 1;
			const yRow = (COMP_H - 1 - X) * COMP_W;
			for (let Y = 0; Y < WIRE_H; Y++) {
				out[yRow + Y] = ((this.fb[Y * ROW_BYTES + byteCol] >> shift) & 0x0f) * 17;
			}
		}
		this.png = { key, buf: encodeGrayPng(out, COMP_W, COMP_H) };
		return this.png.buf;
	}

	hasFrame(): boolean {
		return this.digest !== '';
	}
}
