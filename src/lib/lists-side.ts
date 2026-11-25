// The Lists tab's first two sides (owner, 2026-11-25): Lists holds shopping and other lists,
// Tasks holds to-do lists and Coming up. A list's own page lives under its side.
export type ListSide = 'lists' | 'tasks';

export const sideOf = (kind: string): ListSide => (kind === 'todo' ? 'tasks' : 'lists');

/** A list's own page. */
export const listUrl = (l: { id: number; kind: string }) => `/planner/${sideOf(l.kind)}?list=${l.id}`;
