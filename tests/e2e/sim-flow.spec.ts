import { expect, test, type Page } from '@playwright/test';

// The wall end to end (docs/testing.md §2): side buttons repaint the simulated wall's Home
// screen (the only one since ADR-35). With E2E_TESSERAE=1 the simulator's buttons drive the fake
// E1003 (the screen logic Tesserae's button webhook reaches) instead of the direct render.
const PIN = process.env.E2E_PIN ?? '246810';
const viaTesserae = process.env.E2E_TESSERAE === '1';

async function login(page: Page) {
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner'); // Home is the landing page (ADR-38)
}

// The wall has no touch (ADR-28): its side buttons change the screen, ticks happen on phones.
async function openSim(page: Page) {
	await page.goto('/sim');
	if (!viaTesserae) await page.getByRole('tab', { name: 'Direct' }).click();
}
async function press(page: Page, button: 'Previous page' | 'Home' | 'Next page', expectLabel: string) {
	await page.getByRole('button', { name: button, exact: true }).click();
	await expect(page.getByTestId('outcome')).toHaveText(new RegExp(`→ ${expectLabel}$`));
}

test('every side button repaints Home; there is no page strip', async ({ page }) => {
	await login(page);
	await openSim(page);
	await press(page, 'Next page', 'Home'); // the wall shows Home only (ADR-35)
	await press(page, 'Previous page', 'Home');
	await press(page, 'Home', 'Home');
	if (!viaTesserae) {
		const wall = page.getByTestId('direct');
		await expect(wall.locator('.fh-pages')).toHaveCount(0);
		await page.screenshot({ path: 'test-results/wall-home.png' });
	}
});

/** Mean darkness (0–1) of the checkbox area inside a glass tap region, read from the PNG. */
async function boxDarkness(page: Page, region: ReturnType<Page['locator']>): Promise<number> {
	return region.evaluate(async (btn) => {
		const img = btn.parentElement!.querySelector('img') as HTMLImageElement;
		const fresh = new Image();
		fresh.src = `/sim/glass.png?t=${Date.now()}`;
		await fresh.decode();
		const scale = img.width / 1404;
		const x = (parseFloat((btn as HTMLElement).style.left) / scale) + 40;
		const y = (parseFloat((btn as HTMLElement).style.top) / scale) + 30;
		const c = document.createElement('canvas');
		c.width = 1404;
		c.height = 1872;
		const ctx = c.getContext('2d')!;
		ctx.drawImage(fresh, 0, 0);
		const d = ctx.getImageData(x, y, 60, 30).data;
		let dark = 0;
		for (let i = 0; i < d.length; i += 4) dark += 1 - d[i] / 255;
		return dark / (d.length / 4);
	});
}
