import raw from '../../tesserae/paint/icons.json';

// Family Hub's one icon set (scripts/build-icons.ts, docs/design.md): two-tone Phosphor icons used
// by the wall painter, /sim and the Planner.
export type Icon = { bg?: string; fg?: string; bold?: string; stroke?: string };
const { $ui, ...icons } = raw as unknown as { $ui: string[] } & Record<string, Icon>;
export const ICONS: Record<string, Icon> = icons;
/** Names offered for steps, lists, members and day types (interface icons excluded). */
export const GLYPH_NAMES = Object.keys(ICONS).filter((n) => !$ui.includes(n));
