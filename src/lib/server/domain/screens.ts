// Which screen each wall is showing: home ('home': date, today, urgent to-dos, the week), the
// children's routines ('routines', one child at a time), the lists ('lists') or the baby's day
// plan ('plan'). Buttons on the wall open them; Back, or a few idle minutes, returns home.
// The routines screen opened during a routine stays up until that routine's window closes.
// Kept in memory: after a restart every wall starts on home.

export type Screen = 'home' | 'lists' | 'plan' | 'routines';

/** Screens other than home close by themselves after this long without a tap on them. */
export const LISTS_IDLE_MS = 3 * 60_000;

export class WallScreens {
	// device → screen, last activity, held open until (ms; 0 = idle timer only), and which child
	private open = new Map<string, { screen: Exclude<Screen, 'home'>; since: number; until: number; member: number | null }>();

	get(deviceId: string, now = new Date()): Screen {
		const o = this.open.get(deviceId);
		return o !== undefined && now.getTime() < Math.max(o.since + LISTS_IDLE_MS, o.until) ? o.screen : 'home';
	}

	/** The child picked on the routines screen (null = not picked: the page chooses). */
	member(deviceId: string, now = new Date()): number | null {
		return this.get(deviceId, now) === 'routines' ? (this.open.get(deviceId)?.member ?? null) : null;
	}

	/**
	 * Show `screen` on the device (opening a screen, or a tap on it, restarts the idle timer).
	 * `until` (ms) keeps it open past the idle timer: the end of the routine on now.
	 */
	set(deviceId: string, screen: Screen, now = new Date(), member: number | null = null, until = 0): void {
		if (screen === 'home') this.open.delete(deviceId);
		else this.open.set(deviceId, { screen, since: now.getTime(), until, member });
	}

	/** A tap on the open screen keeps it open (and may extend the hold). */
	touch(deviceId: string, now = new Date(), until = 0): void {
		const o = this.open.get(deviceId);
		if (o && this.get(deviceId, now) !== 'home') {
			o.since = now.getTime();
			o.until = Math.max(o.until, until);
		}
	}

	reset(): void {
		this.open.clear();
	}
}

const g = globalThis as unknown as { __familyHubScreens?: WallScreens };
/** One per process (survives dev-server module reloads). */
export const wallScreens: WallScreens = (g.__familyHubScreens ??= new WallScreens());
