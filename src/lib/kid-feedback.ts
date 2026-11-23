// Sounds and buzzes for the kid view. Sounds are made with Web Audio (no files to load or cache).
// iPads have no vibration motor and Safari has no Vibration API, so there the sound and the
// animation are the feedback; Android tablets and phones also buzz.

const SOUND_KEY = 'fh-kids-sound';

let ctx: AudioContext | null = null;

// iOS gives Web Audio the "ambient" session by default, which the iPad's mute setting silences.
// "playback" plays through mute, like a game or video would (Safari 17+; ignored elsewhere).
function playbackSession() {
	try {
		const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
		if (session && session.type !== 'playback') session.type = 'playback';
	} catch {
		/* not supported */
	}
}

function audio(): AudioContext | null {
	try {
		playbackSession();
		if (ctx?.state === 'closed') ctx = null;
		if (!ctx) {
			ctx = new AudioContext();
			// A silent sample inside the first tap is what unlocks audio on iOS.
			const src = ctx.createBufferSource();
			src.buffer = ctx.createBuffer(1, 1, 22050);
			src.connect(ctx.destination);
			src.start(0);
		}
		// iOS starts "suspended" and goes "interrupted" after the app is backgrounded or the
		// screen sleeps; resuming inside a tap brings it back.
		if (ctx.state !== 'running') void ctx.resume();
		return ctx;
	} catch {
		return null;
	}
}

/** Call from a tap handler so the first real sound is not lost to the unlock. */
export function unlockAudio() {
	if (soundOn()) audio();
}

/** One soft note: frequency in Hz, start offset and length in seconds. */
function note(ac: AudioContext, freq: number, at: number, len: number, type: OscillatorType = 'triangle', vol = 0.22) {
	const t = ac.currentTime + at;
	const osc = ac.createOscillator();
	const gain = ac.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, t);
	gain.gain.setValueAtTime(0.0001, t);
	gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
	gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
	osc.connect(gain).connect(ac.destination);
	osc.start(t);
	osc.stop(t + len + 0.05);
}

function buzz(pattern: number | number[]) {
	try {
		navigator.vibrate?.(pattern);
	} catch {
		/* not supported */
	}
}

export function soundOn(): boolean {
	try {
		return localStorage.getItem(SOUND_KEY) !== 'off';
	} catch {
		return true;
	}
}

export function setSoundOn(on: boolean) {
	try {
		if (on) localStorage.removeItem(SOUND_KEY);
		else localStorage.setItem(SOUND_KEY, 'off');
	} catch {
		/* private mode: just this visit */
	}
}

export type Cue = 'tick' | 'untick' | 'hint' | 'allDone' | 'error';

export function cue(kind: Cue, sound = soundOn()) {
	buzz({ tick: 35, untick: [20, 60, 20], hint: 15, allDone: [40, 60, 40, 60, 120], error: [80, 40, 80] }[kind]);
	if (!sound) return;
	const ac = audio();
	if (!ac) return;
	if (ac.state === 'running') play(ac, kind);
	else ac.resume().then(() => play(ac, kind), () => {});
}

function play(ac: AudioContext, kind: Cue) {
	switch (kind) {
		case 'tick': // a bright "ding-ding" up
			note(ac, 784, 0, 0.18); // G5
			note(ac, 1175, 0.08, 0.3); // D6
			break;
		case 'untick': // a soft step down
			note(ac, 523, 0, 0.18, 'sine'); // C5
			note(ac, 392, 0.1, 0.25, 'sine'); // G4
			break;
		case 'hint': // a tiny tap
			note(ac, 660, 0, 0.08, 'sine', 0.12);
			break;
		case 'allDone': // a little fanfare
			[523, 659, 784, 1047].forEach((f, i) => note(ac, f, i * 0.11, 0.3));
			note(ac, 1319, 0.48, 0.6);
			note(ac, 1047, 0.48, 0.6, 'sine', 0.12);
			break;
		case 'error':
			note(ac, 220, 0, 0.2, 'square', 0.08);
			note(ac, 196, 0.18, 0.25, 'square', 0.08);
			break;
	}
}
