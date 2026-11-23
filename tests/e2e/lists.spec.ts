import { expect, test } from '@playwright/test';

// Lists index and list pages (ADR-39), phone-sized: the Lists · Notes · Gifts switch on the index
// pages, the index rows open a list on its own page with a back link, items are added from the
// last row, Coming up shows only when something is due, and the Lists tab reopens the side last used.
const PIN = process.env.E2E_PIN ?? '246810';
const SHOTS = process.env.E2E_SHOTS;

test.use({ viewport: { width: 390, height: 844 } });

test('lists: index, list page, add row, Coming up, three-way switch', async ({ page }) => {
	const name = `Jobs ${Math.random().toString(36).slice(2, 6)}`;
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner');

	// The index: switch, title, no Coming up while nothing is due, one row per list.
	const tabs = page.getByRole('navigation', { name: 'Planner', exact: true });
	const sides = page.getByRole('navigation', { name: 'Lists, notes and gifts' });
	await tabs.getByRole('link', { name: 'Lists' }).click();
	await page.waitForURL(/\/planner\/lists$/);
	await expect(sides.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');
	await expect(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Coming up' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'All lists' })).toBeVisible();
	await expect(page.locator('.index a', { hasText: 'Shopping' })).toBeVisible();

	// Old Coming up links land on the index.
	await page.goto('/planner/lists?view=coming');
	await expect(page).toHaveURL(/\/planner\/lists$/);

	// + opens the new list form; a new list opens on its own page, without the switch.
	await page.getByRole('button', { name: 'New list' }).click();
	await page.getByPlaceholder('e.g. House jobs').fill(name);
	await page.getByLabel('Kind').selectOption('todo');
	await page.getByRole('button', { name: 'Create' }).click();
	await page.waitForURL(/\/planner\/lists\?list=\d+$/);
	const listUrl = page.url();
	await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
	await expect(sides).toHaveCount(0);

	// Add from the last row: Enter adds, clears the box and keeps the keyboard up.
	const add = page.getByLabel('New item');
	await add.fill('Fix the gate');
	await add.press('Enter');
	await expect(page.getByRole('link', { name: 'Fix the gate' })).toBeVisible();
	await expect(add).toHaveValue('');
	await expect(add).toBeFocused();
	await add.fill('Oil the hinges');
	await add.press('Enter');
	await expect(page.getByRole('link', { name: 'Oil the hinges' })).toBeVisible();

	// Flag one Now (edit mode), then the index shows it under Coming up.
	await page.getByRole('button', { name: 'List options' }).click();
	await page.getByRole('button', { name: 'Edit items' }).click();
	await page.getByRole('button', { name: 'Flag Fix the gate Now' }).click();
	await expect(page.getByRole('button', { name: 'Unflag Fix the gate Now' })).toBeVisible();
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/lists-list.png`, fullPage: true });

	await page.locator('a.back', { hasText: 'Lists' }).click();
	await page.waitForURL(/\/planner\/lists$/);
	const coming = page.locator('ul[aria-labelledby="h-coming"]');
	await expect(page.getByRole('heading', { name: 'Coming up' })).toBeVisible();
	await expect(coming.getByText('Fix the gate')).toBeVisible();
	await expect(page.locator('.index a', { hasText: name })).toContainText('2');
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/lists-index.png`, fullPage: true });

	// Ticking it there empties Coming up, so the section goes.
	await coming.getByRole('button', { name: 'Mark Fix the gate done' }).click();
	await expect(page.getByRole('heading', { name: 'Coming up' })).toHaveCount(0);

	// The row opens the list; Ticked is a quiet line that opens in place.
	await page.locator('.index a', { hasText: name }).click();
	await expect(page).toHaveURL(listUrl);
	await page.getByText('Ticked 1').click();
	await expect(page.getByRole('button', { name: 'Fix the gate', exact: true })).toHaveAttribute('aria-pressed', 'true');

	// The switch: Gifts is its own side, and the Lists tab reopens it until another side is used.
	await page.goto('/planner/lists');
	await sides.getByRole('link', { name: 'Gifts' }).click();
	await page.waitForURL('**/planner/gifts');
	await expect(sides.getByRole('link', { name: 'Gifts' })).toHaveAttribute('aria-current', 'page');
	await expect(tabs.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');
	await page.goto('/planner');
	await tabs.getByRole('link', { name: 'Lists' }).click();
	await page.waitForURL('**/planner/gifts');
	await page.reload();
	await expect(tabs.getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/planner/gifts');
	await sides.getByRole('link', { name: 'Notes' }).click();
	await page.waitForURL('**/planner/notes');
	await page.goto('/planner');
	await tabs.getByRole('link', { name: 'Lists' }).click();
	await page.waitForURL('**/planner/notes');
	await sides.getByRole('link', { name: 'Lists' }).click();
	await page.waitForURL(/\/planner\/lists$/);

	// Clean up: delete the list from its menu.
	await page.goto(listUrl);
	await page.getByRole('button', { name: 'List options' }).click();
	await page.locator('summary', { hasText: 'Delete list' }).click();
	await page.getByLabel(/and everything on it/).check();
	await page.getByRole('button', { name: 'Delete list' }).click();
	await page.waitForURL(/\/planner\/lists$/);
	await expect(page.locator('.index a', { hasText: name })).toHaveCount(0);
});
