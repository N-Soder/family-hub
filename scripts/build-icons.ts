// Builds tesserae/paint/icons.json: Family Hub's one icon set, two-tone (duotone), from Phosphor
// (MIT, @phosphor-icons/core, dev dependency only). Used by the wall painter (routine.js), /sim
// and the Planner (Glyph.svelte). docs/design.md has the rules.
//
// Each icon is on Phosphor's 256 grid: `bg` the light back layer, `fg` the solid front (regular
// weight), `bold` the front at bold weight (the wall uses it below ~64 px). Hand-drawn gaps carry
// `stroke` (a 16-unit round stroke) instead of `fg`/`bold`. `$ui` lists names that are interface
// icons, not choices for steps, lists or members.
// Run after changing PICK, UI or CUSTOM: npx tsx scripts/build-icons.ts (needs `npm install`:
// Phosphor is a dev dependency). It also rebuilds tesserae/pages/wall.json, which embeds the icons.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWallCanvas } from '../src/lib/server/tesserae/page';

const root = join(process.cwd(), 'node_modules/@phosphor-icons/core/assets');

/** Choices for steps, lists, members and day types: Family Hub name → Phosphor name. */
const PICK: Record<string, string> = {
	star: 'star',
	sun: 'sun',
	moon: 'moon-stars',
	tooth: 'tooth',
	shirt: 't-shirt',
	shoe: 'sneaker',
	sock: 'sock',
	hat: 'baseball-cap',
	bag: 'backpack',
	book: 'book-open',
	bath: 'bathtub',
	bed: 'bed',
	cup: 'pint-glass',
	hands: 'hand-soap',
	toilet: 'toilet',
	brush: 'paint-brush-household',
	heart: 'heart',
	face: 'smiley',
	bus: 'bus',
	swim: 'swimming-pool',
	home: 'house',
	school: 'student',
	cart: 'shopping-cart',
	hammer: 'hammer',
	wrench: 'wrench',
	toolbox: 'toolbox',
	paint: 'paint-roller',
	broom: 'broom',
	laundry: 'washing-machine',
	recycle: 'recycle',
	bulb: 'lightbulb',
	plant: 'plant',
	car: 'car',
	pet: 'paw-print',
	cooking: 'cooking-pot',
	package: 'package',
	gift: 'gift',
	bills: 'receipt',
	bowl: 'bowl-steam',
	baby: 'baby'
};
/** Interface icons (wall and Planner). A [name, 'bold'] pair has no duotone layer. */
const UI: Record<string, string | [string, 'bold']> = {
	check: ['check', 'bold'],
	back: ['caret-left', 'bold'],
	plus: ['plus', 'bold'],
	more: ['dots-three', 'bold'],
	list: 'list-checks',
	calendar: 'calendar-dots',
	family: 'users-three',
	settings: 'sliders-horizontal',
	devices: 'device-tablet',
	refresh: 'arrows-clockwise',
	pin: 'map-pin',
	clock: 'clock',
	themeLight: 'sun-dim',
	themeDark: 'moon',
	signOut: 'sign-out',
	trash: 'trash',
	pencil: 'pencil-simple',
	note: 'note',
	link: 'link-simple',
	// Weather (wall home and Settings)
	wxSun: 'sun',
	wxMoon: 'moon',
	wxCloudSun: 'cloud-sun',
	wxCloudMoon: 'cloud-moon',
	wxCloud: 'cloud',
	wxFog: 'cloud-fog',
	wxRain: 'cloud-rain',
	wxStorm: 'cloud-lightning',
	wind: 'wind',
	// Weather levels on the wall (owner 2026-11-11: the icon follows how windy / wet / strong).
	windLight: 'leaf',
	windStrong: 'flag-banner',
	rainNone: 'drop-slash',
	rainLow: 'drop-half-bottom',
	rainMid: 'drop',
	rainHigh: 'umbrella',
	uvLow: 'sun-dim',
	arrow: ['arrow-up', 'bold']
};
/** Drawn here: Phosphor has no apple (only an orange) and no baby bottle. Same grid and stroke as the set. */
const CUSTOM: Record<string, { bg: string; stroke: string }> = {
	apple: {
		bg: 'M128,92C108,74,52,70,48,130S88,224,108,224c10,0,14-6,20-6s10,6,20,6c20,0,64-34,60-94S148,74,128,92Z',
		stroke:
			'M128,92C108,74,52,70,48,130S88,224,108,224c10,0,14-6,20-6s10,6,20,6c20,0,64-34,60-94S148,74,128,92ZM128,92c0-24,10-44,30-56M134,64c6-18,22-28,42-26c-2,20-20,30-42,26Z'
	},
	// Baby bottle: teat, collar, body with milk (back layer) and two level marks.
	bottle: {
		bg: 'M84,150H172V208a20,20,0,0,1-20,20H104a20,20,0,0,1-20-20Z',
		stroke:
			'M112,64C112,44,120,28,128,28S144,44,144,64M96,64H160V88H96ZM104,88h48a20,20,0,0,1,20,20V208a20,20,0,0,1-20,20H104a20,20,0,0,1-20-20V108A20,20,0,0,1,104,88ZM84,150H112M84,186H112'
	}
};

type Icon = { bg?: string; fg?: string; bold?: string; stroke?: string };
const paths = (weight: string, ph: string) => {
	const suffix = weight === 'regular' ? '' : `-${weight}`;
	const svg = readFileSync(join(root, weight, `${ph}${suffix}.svg`), 'utf8');
	const bg: string[] = [];
	const fg: string[] = [];
	for (const m of svg.matchAll(/<path d="([^"]+)"([^>]*)\/>/g)) (m[2].includes('opacity') ? bg : fg).push(m[1]);
	if (!fg.length) throw new Error(`${ph} (${weight}): no paths`);
	return { bg: bg.join(''), fg: fg.join('') };
};

const out: Record<string, Icon | string[]> = { $ui: Object.keys(UI) };
for (const [name, spec] of Object.entries({ ...PICK, ...UI })) {
	if (Array.isArray(spec)) {
		out[name] = { fg: paths(spec[1], spec[0]).fg };
		continue;
	}
	const duo = paths('duotone', spec);
	out[name] = { bg: duo.bg, fg: duo.fg, bold: paths('bold', spec).fg };
}
Object.assign(out, CUSTOM);

writeFileSync('tesserae/paint/icons.json', JSON.stringify(out) + '\n');
console.log(`tesserae/paint/icons.json: ${Object.keys(out).length - 1} icons`);
writeFileSync('tesserae/pages/wall.json', JSON.stringify(buildWallCanvas(), null, 2) + '\n');
console.log('wrote tesserae/pages/wall.json');
