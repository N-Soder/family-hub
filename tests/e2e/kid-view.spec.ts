import { expect, test } from '@playwright/test';

// Kid view on a tablet (ADR-27): tap ticks and saves, a long press ticks before the lift, a quick tap on a done card does not untick,
// a hold does; the tablet stays in kid view until a grown-up holds the exit button.
const PIN = process.env.E2E_PIN ?? '246810';

test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true });

test('kid view: tap to tick, hold to undo, hold to leave', async ({ page }) => {
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner');

	await page.goto('/planner/kids');
	const card = page.locator('.step').first();
	await expect(card).toBeVisible();
	// Start from not done (an earlier run may have ticked it).
	if ((await card.getAttribute('aria-pressed')) === 'true') {
		await card.focus();
		await page.keyboard.press('Enter');
		await expect(card).toHaveAttribute('aria-pressed', 'false');
		await page.waitForTimeout(800);
	}

	await card.tap();
	await expect(card).toHaveAttribute('aria-pressed', 'true');
	await page.waitForTimeout(800); // past the per-card lock
	await page.reload();
	await expect(card).toHaveAttribute('aria-pressed', 'true'); // saved

	await card.tap(); // a quick tap on a done card only shows the hint
	await expect(page.getByText('Hold to undo')).toBeVisible();
	await expect(card).toHaveAttribute('aria-pressed', 'true');

	const box = (await card.boundingBox())!;
	await page.waitForTimeout(800);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(1100);
	await page.mouse.up();
	await expect(card).toHaveAttribute('aria-pressed', 'false');

	// A long press ticks while the finger is still down (no need to lift).
	await page.waitForTimeout(800);
	await page.mouse.down();
	await expect(card).toHaveAttribute('aria-pressed', 'true');
	await page.mouse.up();

	// The tablet now reopens in kid view…
	await page.goto('/planner/lists');
	await page.waitForURL('**/planner/kids');
	// …until a grown-up holds the exit button.
	const exit = (await page.getByRole('button', { name: /Grown-ups/ }).boundingBox())!;
	await page.mouse.move(exit.x + 10, exit.y + 10);
	await page.mouse.down();
	await page.waitForTimeout(2300);
	await page.mouse.up();
	await page.waitForURL(/\/planner\/routines$/); // back to Routines, where the kid view opens from
	await page.goto('/planner/lists');
	await expect(page).toHaveURL(/\/planner\/lists$/);
});
