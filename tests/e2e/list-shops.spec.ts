import { expect, test } from '@playwright/test';

// Shops on a list (ADR-41), phone-sized: add shops in ⋯, tie an item to one on its page, then
// the shop switch hides only items tied to another shop, with a line to show them.
const PIN = process.env.E2E_PIN ?? '246810';
const SHOTS = process.env.E2E_SHOTS;

test.use({ viewport: { width: 390, height: 844 } });

test('list shops: add shops, tag an item, filter with the switch', async ({ page }) => {
	const name = `Groceries ${Math.random().toString(36).slice(2, 6)}`;
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner');

	await page.goto('/planner/lists');
	await page.getByRole('button', { name: 'New list' }).click();
	await page.getByPlaceholder('e.g. Bunnings').fill(name);
	await page.getByRole('button', { name: 'Create' }).click();
	await page.waitForURL(/\/planner\/lists\?list=\d+$/);
	const listUrl = page.url();

	const add = page.getByLabel('New item');
	for (const t of ['Milk', 'Sourdough', 'Hummus']) {
		await add.fill(t);
		await add.press('Enter');
		await expect(page.locator('.items li', { hasText: t })).toBeVisible();
	}
	// No shops yet: no switch.
	const sw = page.getByRole('group', { name: 'Shopping at' });
	await expect(sw).toHaveCount(0);

	// ⋯ → Shops: add two.
	await page.getByRole('button', { name: 'List options' }).click();
	await page.locator('summary', { hasText: 'Shops' }).click();
	const newShop = page.getByLabel('New shop');
	await newShop.fill('Grocer');
	await newShop.press('Enter');
	await expect(page.locator('.shops li', { hasText: 'Grocer' })).toBeVisible();
	await newShop.fill('Warehouse');
	await newShop.press('Enter');
	await expect(page.locator('.shops li', { hasText: 'Warehouse' })).toBeVisible();
	await expect(sw.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/list-shops-settings.png`, fullPage: true });

	// Tie Sourdough to Grocer and Hummus to Warehouse on their pages.
	for (const [item, shop] of [['Sourdough', 'Grocer'], ['Hummus', 'Warehouse']]) {
		await page.getByRole('link', { name: `Details for ${item}` }).click();
		await page.waitForURL(/\/planner\/lists\/item\/\d+$/);
		await page.locator('label.choice', { hasText: shop }).click();
		await expect(page.getByRole('radio', { name: shop })).toBeChecked();
		if (SHOTS && shop === 'Warehouse') await page.screenshot({ path: `${SHOTS}/list-shops-item.png`, fullPage: true });
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('status')).toHaveText('Saved.');
		await page.goto(listUrl);
	}
	await expect(page.locator('.items li', { hasText: 'Hummus' }).locator('.shop')).toHaveText('Warehouse');

	// At Grocer: Hummus (Warehouse) is hidden; Milk (any shop) and Sourdough stay.
	await sw.getByRole('button', { name: 'Grocer' }).click();
	await expect(page.locator('.items li', { hasText: 'Hummus' })).toHaveCount(0);
	await expect(page.locator('.items li', { hasText: 'Milk' })).toBeVisible();
	await expect(page.locator('.items li', { hasText: 'Sourdough' })).toBeVisible();
	// The tag that repeats the filter is dropped.
	await expect(page.locator('.items li', { hasText: 'Sourdough' }).locator('.shop')).toHaveCount(0);
	const line = page.locator('.hidden-line');
	await expect(line).toContainText('1 item for Warehouse hidden');
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/list-shops.png`, fullPage: true });

	// Show brings it back dimmed; Hide hides it again.
	await line.getByRole('button', { name: 'Show' }).click();
	await expect(page.locator('.items li.away', { hasText: 'Hummus' })).toBeVisible();
	await line.getByRole('button', { name: 'Hide' }).click();
	await expect(page.locator('.items li', { hasText: 'Hummus' })).toHaveCount(0);

	// The pick is remembered on this phone.
	await page.reload();
	await expect(sw.getByRole('button', { name: 'Grocer' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.items li', { hasText: 'Hummus' })).toHaveCount(0);

	// All shows everything.
	await sw.getByRole('button', { name: 'All' }).click();
	await expect(page.locator('.items li', { hasText: 'Hummus' })).toBeVisible();
	await expect(line).toHaveCount(0);
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/list-shops-all.png`, fullPage: true });
});
