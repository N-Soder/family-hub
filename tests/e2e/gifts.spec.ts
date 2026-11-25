import { expect, test } from '@playwright/test';

// Gifts (SPEC §5.2, its own side of the Lists tab since ADR-39): add a person and ideas, mark one bought, mark the occasion given, and see
// the "gave this before" notice. Phone-sized, like the everyday Planner.
const PIN = process.env.E2E_PIN ?? '246810';
const SHOTS = process.env.E2E_SHOTS;

test.use({ viewport: { width: 390, height: 844 } });

test('gifts: ideas, bought, given and history', async ({ page }) => {
	const name = `Nan ${Math.random().toString(36).slice(2, 6)}`;
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner');

	await page.goto('/planner/lists');
	await page.getByRole('navigation', { name: 'Lists, tasks, notes and gifts' }).getByRole('link', { name: 'Gifts' }).click();
	await page.waitForURL('**/planner/gifts');
	if (await page.getByRole('button', { name: 'Person' }).isVisible()) await page.getByRole('button', { name: 'Person' }).click();
	await page.getByPlaceholder('e.g. Mum').fill(name);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();

	const add = page.getByLabel('New idea');
	await add.fill('Slippers');
	await add.press('Enter');
	await expect(page.locator('.items').first().getByText('Slippers')).toBeVisible();
	await add.fill('Jigsaw puzzle');
	await add.press('Enter');
	await expect(page.getByText('Jigsaw puzzle')).toBeVisible();
	await add.fill('slippers');
	await add.press('Enter');
	await expect(page.getByText(/Slippers is already on/)).toBeVisible();

	await page.getByRole('button', { name: 'Mark Slippers bought' }).click();
	await expect(page.getByRole('heading', { name: 'Bought' })).toBeVisible();
	await expect(page.getByText(/^Christmas \d{4}$/).first()).toBeVisible();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/gifts-person.png`, fullPage: true });

	await page.goto('/planner/gifts');
	await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText('1 idea · 1 bought');
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/gifts-home.png`, fullPage: true });

	await page.getByRole('link', { name: new RegExp(name) }).click();
	await page.getByRole('button', { name: 'Given' }).click();
	await expect(page.getByText(/^Given \(1\)$/)).toBeVisible();
	await add.fill('Slippers');
	await add.press('Enter');
	await expect(page.getByText(new RegExp(`You gave ${name} Slippers at Christmas \\d{4}`))).toBeVisible();

	await page.getByRole('link', { name: 'Jigsaw puzzle' }).click();
	await page.getByLabel('Price').fill('$45');
	await page.getByLabel('Notes').fill('https://www.example.com/jigsaw');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'example.com' })).toBeVisible();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/gifts-idea.png`, fullPage: true });

	// Clean up so the shared e2e database does not collect people.
	await page.getByRole('link', { name }).and(page.locator('a.back')).click();
	await page.getByRole('button', { name: 'Person options' }).click();
	await page.getByText(`Delete ${name}`, { exact: true }).click();
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await page.waitForURL('**/planner/gifts');
});
