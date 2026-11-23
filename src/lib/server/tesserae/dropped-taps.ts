/*
 * Clean up after taps Tesserae drops.
 *
 * The device inverts a tapped region on its own the instant it is touched
 * (tier-0 feedback), before Tesserae has decided anything. When Tesserae then
 * drops the tap (e.g. `stale`: it landed while the frame was being replaced),
 * no webhook reaches us and nothing repaints that region, so it stays black.
 * Tesserae records the drop in its touch log; we read that log while a wall is
 * being used and send a full frame when a drop shows up (architecture §9).
 */

export interface TouchEvent {
	id: number;
	timestamp: number; // seconds
	status: string;
}

export interface TouchLog {
	recent(deviceId: string): Promise<TouchEvent[]>;
}

/** Outcomes that leave the device's invert on glass with no repaint coming. */
export const DROPPED = new Set(['stale', 'unmapped', 'failed', 'error']);

export class DroppedTapWatch {
	private lastId = new Map<string, number>();
	private activeUntil = new Map<string, number>();
	private timer: NodeJS.Timeout | null = null;
	private readonly startedAt: number;

	constructor(
		private log: TouchLog,
		private onDropped: (deviceId: string) => void,
		private opts: { windowMs?: number; everyMs?: number; now?: () => number } = {}
	) {
		this.startedAt = this.now();
	}

	private now(): number {
		return (this.opts.now ?? Date.now)();
	}

	/** Look for new dropped taps on one device; true (and a repaint request) when found. */
	async check(deviceId: string): Promise<boolean> {
		const events = await this.log.recent(deviceId);
		const last = this.lastId.get(deviceId);
		const fresh = events.filter((e) => (last === undefined ? e.timestamp * 1000 >= this.startedAt : e.id > last));
		if (events.length) this.lastId.set(deviceId, Math.max(last ?? 0, ...events.map((e) => e.id)));
		const dropped = fresh.some((e) => DROPPED.has(e.status));
		if (dropped) this.onDropped(deviceId);
		return dropped;
	}

	/** A wall is being used: poll its touch log for the next while (drops cluster around taps). */
	watch(deviceId: string): void {
		this.activeUntil.set(deviceId, this.now() + (this.opts.windowMs ?? 30_000));
		if (this.timer) return;
		this.timer = setInterval(() => void this.poll(), this.opts.everyMs ?? 3_000);
	}

	private async poll(): Promise<void> {
		const t = this.now();
		for (const [id, until] of this.activeUntil) {
			if (until < t) this.activeUntil.delete(id);
			else await this.check(id).catch(() => false);
		}
		if (this.activeUntil.size === 0 && this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
