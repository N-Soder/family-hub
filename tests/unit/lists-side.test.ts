import { describe, expect, it } from 'vitest';
import { listUrl, sideOf } from '../../src/lib/lists-side';

describe('Lists and Tasks sides (ADR-40)', () => {
	it('to-do lists live on Tasks, shopping and other lists on Lists', () => {
		expect(sideOf('todo')).toBe('tasks');
		expect(sideOf('grocery')).toBe('lists');
		expect(sideOf('other')).toBe('lists');
		expect(listUrl({ id: 7, kind: 'todo' })).toBe('/planner/tasks?list=7');
		expect(listUrl({ id: 3, kind: 'grocery' })).toBe('/planner/lists?list=3');
	});
});
