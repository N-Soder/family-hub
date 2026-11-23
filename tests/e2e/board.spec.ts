import { expect, test, type Page } from '@playwright/test';

// The Board (ADR-30): paired with a code from Settings, shows the family's day, ticks show on
// the phone, and Settings can unpair it again.
const PIN = process.env.E2E_PIN ?? '246810';

async function login(page: Page) {
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner');
}

test('pair a screen, tick from the board, see it on the phone, unpair', async ({ browser, page }) => {
	await login(page);
	// The Lists index (ADR-39): the Shopping row opens the list.
	await page.goto('/planner/lists');
	await page.locator('.index a', { hasText: 'Shopping' }).click();
	await page.waitForURL(/\?list=\d+$/);
	const shopping = page.url();
	const item = `Board apples ${Date.now() % 10000}`;
	await page.getByLabel('New item').fill(item);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.locator('button.item', { hasText: item })).toBeVisible();

	await page.goto('/planner/settings');
	await page.getByRole('button', { name: 'Pair a screen' }).click();
	const code = (await page.locator('.digits').innerText()).trim();
	expect(code).toMatch(/^\d{6}$/);

	// A fresh browser (no Planner session) is sent to the pairing page.
	const tvContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
	const tv = await tvContext.newPage();
	await tv.goto('/board');
	await tv.waitForURL('**/board/pair');
	await tv.getByLabel('Code').fill('000000' === code ? '000001' : '000000');
	await tv.getByRole('button', { name: 'Pair' }).click();
	await expect(tv.getByRole('alert')).toContainText('not right');
	await tv.getByLabel('Code').fill(code);
	await tv.getByLabel('Name this screen').fill('E2E TV');
	await tv.getByRole('button', { name: 'Pair' }).click();
	await tv.waitForURL('**/board');
	await expect(tv.getByRole('heading', { level: 1 })).toBeVisible();

	// Tick the first step of the routine shown and the new shopping item.
	const step = tv.locator('.steps .row').first();
	await expect(step).toBeVisible();
	const stepTitle = (await step.locator('.title').innerText()).trim();
	if ((await step.getAttribute('aria-pressed')) === 'true') {
		await step.click();
		await expect(step).toHaveAttribute('aria-pressed', 'false');
		await tv.waitForTimeout(800);
	}
	await step.click();
	await expect(step).toHaveAttribute('aria-pressed', 'true');
	const row = tv.locator('.items .row', { hasText: item });
	await row.click();
	await expect(row).toHaveAttribute('aria-pressed', 'true');
	await tv.waitForTimeout(500);
	await tv.reload();
	await expect(tv.locator('.steps .row', { hasText: stepTitle })).toHaveAttribute('aria-pressed', 'true'); // saved

	// The phone sees both.
	await page.goto('/planner/routines');
	await expect(page.locator(`.tick[data-step="${stepTitle}"]`)).toHaveAttribute('aria-pressed', 'true');
	await page.goto(shopping);
	await expect(page.locator('button.item', { hasText: item })).toHaveAttribute('aria-pressed', 'true');

	// Settings lists the screen; unpairing sends it back to the pairing page.
	await page.goto('/planner/settings');
	const paired = page.locator('.boards li', { hasText: 'E2E TV' });
	await expect(paired).toBeVisible();
	await paired.getByRole('button', { name: 'Unpair' }).click();
	await expect(page.locator('.boards li', { hasText: 'E2E TV' })).toHaveCount(0);
	await tv.goto('/board');
	await tv.waitForURL('**/board/pair');
	await tvContext.close();

	// Leave the shopping list as it was for the wall test: post the list page's own remove action.
	await page.goto(shopping);
	const tickForm = page.locator('form', { has: page.locator('button.item', { hasText: item }) }).first();
	const itemId = await tickForm.locator('input[name=itemId]').inputValue();
	const listId = await tickForm.locator('input[name=listId]').inputValue();
	const origin = new URL(page.url()).origin;
	const res = await page.request.post(`${origin}/planner/lists?/remove`, { form: { itemId, listId }, headers: { origin } });
	expect(res.ok()).toBe(true);
	await page.reload();
	await expect(page.locator('button.item', { hasText: item })).toHaveCount(0);
});
