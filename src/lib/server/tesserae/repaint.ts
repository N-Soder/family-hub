import type { DB } from '../db';
import { device } from '../db/schema';
import { wallViewKey } from '../domain/render';
import { wallScreens, type Screen, type WallScreens } from '../domain/screens';
import { publish } from '../events';

/*
 * After any state change, repaint every wall device as fast as possible.
 *
 * Tesserae diffs each render against the device's last full frame (the
 * anchor) while the firmware copies patch rects into its own framebuffer, so
 * a row that changes and then changes back would never be repainted
 * (architecture §8, S3b). Rule: a row's first change since the anchor goes out
 * as a patch (fast, no flash); a second change of the same row, a routine
 * switch, an unknown anchor or a failed push triggers a full frame and a new
 * anchor. Pushes per device are serialised and bursts coalesce.
 */

export interface PushOutcome {
	ok: boolean;
	status: string;
	ms: number;
}

export interface Pusher {
	patch(tesseraePageId: string, deviceId: string): Promise<PushOutcome>;
	full(tesseraePageId: string, deviceId: string): Promise<PushOutcome>;
}

export interface WallBinding {
	deviceId: string;
	page: string;
	tesseraePageId: string;
}

interface DeviceState {
	anchorView: string | undefined; // what the last full frame showed (wallViewKey); undefined = unknown → next push is full
	touched: Set<string>; // rows changed since the anchor: `s<step id>` or `i<list item id>`
	duringFull: Set<string> | null;
	needFull: boolean;
	dirty: boolean;
	running: Promise<void> | null;
}

export function wallBindings(db: DB): WallBinding[] {
	return db
		.select()
		.from(device)
		.all()
		.flatMap((d) => {
			const s = JSON.parse(d.settingsJson) as { tesseraePageId?: string; page?: string };
			return s.tesseraePageId ? [{ deviceId: d.id, page: s.page ?? 'home', tesseraePageId: s.tesseraePageId }] : [];
		});
}

export class Repainter {
	private states = new Map<string, DeviceState>();
	public log: Array<{ deviceId: string; mode: 'patch' | 'full'; status: string }> = [];

	constructor(
		private db: () => DB,
		private pusher: Pusher | null,
		private now: () => Date = () => new Date(),
		private screens: WallScreens = wallScreens
	) {}

	private viewKey(b: WallBinding): string {
		const now = this.now();
		return wallViewKey(this.db(), b.page, { now, screen: this.screens.get(b.deviceId, now), member: this.screens.member(b.deviceId, now) });
	}

	private state(id: string): DeviceState {
		let s = this.states.get(id);
		if (!s) {
			s = { anchorView: undefined, touched: new Set(), duringFull: null, needFull: false, dirty: false, running: null };
			this.states.set(id, s);
		}
		return s;
	}

	/**
	 * Record changed rows and schedule a repaint of every wall (or one device, or only the walls
	 * showing `screen`). Rows are occurrence step ids, or `i<id>` for list items.
	 */
	notify(rows: Array<number | string> = [], opts: { full?: boolean; deviceId?: string; screen?: Screen | Screen[] } = {}): Promise<void> {
		if (!this.pusher) return Promise.resolve();
		const runs: Promise<void>[] = [];
		for (const b of wallBindings(this.db())) {
			if (opts.deviceId && b.deviceId !== opts.deviceId) continue;
			if (opts.screen && ![opts.screen].flat().includes(this.screens.get(b.deviceId, this.now()))) continue;
			const s = this.state(b.deviceId);
			for (const row of rows) {
				const id = typeof row === 'number' ? `s${row}` : row;
				if (s.touched.has(id)) s.needFull = true;
				s.touched.add(id);
				s.duringFull?.add(id);
			}
			if (opts.full) s.needFull = true;
			s.dirty = true;
			runs.push(this.kick(b));
		}
		return Promise.all(runs).then(() => undefined);
	}

	/** Called on a timer: full repaint when what a wall shows has changed (window start/end, checklist done → week, rollover, lists closing, ticked items dropping off). */
	tick(): Promise<void> {
		if (!this.pusher) return Promise.resolve();
		const runs: Promise<void>[] = [];
		for (const b of wallBindings(this.db())) {
			const s = this.state(b.deviceId);
			const view = this.viewKey(b);
			if (s.anchorView !== undefined && s.anchorView !== view && !s.running) {
				s.dirty = true;
				runs.push(this.kick(b));
			}
		}
		return Promise.all(runs).then(() => undefined);
	}

	private kick(b: WallBinding): Promise<void> {
		const s = this.state(b.deviceId);
		if (s.running) return s.running;
		s.running = (async () => {
			try {
				while (s.dirty) {
					s.dirty = false;
					const view = this.viewKey(b);
					const full = s.needFull || s.anchorView === undefined || s.anchorView !== view;
					let out: PushOutcome;
					if (full) {
						s.needFull = false;
						s.duringFull = new Set();
						out = await this.pusher!.full(b.tesseraePageId, b.deviceId).catch((e: unknown) => ({ ok: false, status: String(e), ms: 0 }));
						const during = s.duringFull;
						s.duringFull = null;
						if (out.ok) {
							s.anchorView = view;
							s.touched = during; // conservative: may or may not be in the new anchor
						} else s.anchorView = undefined;
					} else {
						out = await this.pusher!.patch(b.tesseraePageId, b.deviceId).catch((e: unknown) => ({ ok: false, status: String(e), ms: 0 }));
						if (!out.ok) s.anchorView = undefined;
					}
					this.log.push({ deviceId: b.deviceId, mode: full ? 'full' : 'patch', status: out.status });
					if (this.log.length > 200) this.log.shift();
					publish({ type: 'push', deviceId: b.deviceId, mode: full ? 'full' : 'patch', ms: out.ms, status: out.status });
				}
			} finally {
				s.running = null;
			}
		})();
		return s.running;
	}

	/** Forget anchors (e.g. after a page re-import). */
	reset(deviceId?: string): void {
		if (deviceId) this.states.delete(deviceId);
		else this.states.clear();
	}
}
