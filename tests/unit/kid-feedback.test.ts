import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for Web Audio: enough for kid-feedback to make, resume, play on and close a context.
class FakeContext {
	static made: FakeContext[] = [];
	state: string = 'running';
	currentTime = 0;
	played = 0;
	closed = false;
	destination = {};
	constructor() {
		FakeContext.made.push(this);
	}
	createBufferSource() {
		return { buffer: null, connect() {}, start() {} };
	}
	createBuffer() {
		return {};
	}
	createOscillator() {
		const self = this;
		return { type: '', frequency: { setValueAtTime() {} }, connect: (g: unknown) => g, start() { self.played++; }, stop() {} };
	}
	createGain() {
		return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d };
	}
	resume() {
		this.state = 'running';
		return Promise.resolve();
	}
	close() {
		this.closed = true;
		this.state = 'closed';
		return Promise.resolve();
	}
}

let now = 0;

async function load() {
	vi.resetModules();
	return import('../../src/lib/kid-feedback');
}

beforeEach(() => {
	FakeContext.made = [];
	now = 10_000;
	vi.stubGlobal('AudioContext', FakeContext);
	vi.stubGlobal('performance', { now: () => now });
	vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
	vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());

describe('kid view sound', () => {
	it('keeps one context while it is healthy', async () => {
		const { cue } = await load();
		cue('tick');
		const ac = FakeContext.made[0];
		now += 2000;
		ac.currentTime += 2;
		cue('tick');
		expect(FakeContext.made).toHaveLength(1);
		expect(ac.played).toBeGreaterThan(2);
	});

	it('replaces a context that says running but whose clock has stopped', async () => {
		const { cue } = await load();
		cue('tick');
		const dead = FakeContext.made[0];
		now += 3000; // clock did not move
		cue('tick');
		expect(dead.closed).toBe(true);
		expect(FakeContext.made).toHaveLength(2);
		expect(FakeContext.made[1].played).toBeGreaterThan(0);
	});

	it('replaces an interrupted context', async () => {
		const { unlockAudio } = await load();
		unlockAudio();
		FakeContext.made[0].state = 'interrupted';
		now += 100;
		unlockAudio();
		expect(FakeContext.made).toHaveLength(2);
	});

	it('replaces a context after a long idle, and when the page is hidden', async () => {
		const { unlockAudio, releaseAudio } = await load();
		unlockAudio();
		now += 6 * 60_000;
		FakeContext.made[0].currentTime += 360;
		unlockAudio();
		expect(FakeContext.made).toHaveLength(2);
		releaseAudio();
		expect(FakeContext.made[1].closed).toBe(true);
		unlockAudio();
		expect(FakeContext.made).toHaveLength(3);
	});

	it('plays once a suspended context resumes', async () => {
		const { cue } = await load();
		cue('hint');
		const ac = FakeContext.made[0];
		ac.state = 'suspended';
		ac.played = 0;
		now += 100;
		cue('tick');
		await Promise.resolve();
		expect(ac.played).toBeGreaterThan(0);
	});
});
