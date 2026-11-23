import { expect, test, type Page } from '@playwright/test';

// Shared notes (SPEC §5.3, ADR-37), phone-sized: the Notes tab → new note → type → it saves on
// its own → still there after a reload. Then two phones on the same note: the second one's save
// is refused, it shows the other's note and keeps what was typed. An untouched new note is not kept.
const PIN = process.env.E2E_PIN ?? '246810';
const SHOTS = process.env.E2E_SHOTS;

test.use({ viewport: { width: 390, height: 844 } });

async function signIn(page: Page) {
	await page.goto('/planner/login');
	await page.getByLabel('PIN').fill(PIN);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await page.waitForURL('**/planner');
}

test('notes: autosave, reload, conflict between two phones', async ({ browser, page }) => {
	const heading = `Wifi ${Math.random().toString(36).slice(2, 6)}`;
	await signIn(page);

	// Notes sit with lists: the Lists tab, then the Lists · Notes · Gifts switch (ADR-38, ADR-39).
	await page.getByRole('navigation', { name: 'Planner', exact: true }).getByRole('link', { name: 'Lists' }).click();
	await page.getByRole('navigation', { name: 'Lists, notes and gifts' }).getByRole('link', { name: 'Notes' }).click();
	await page.waitForURL('**/planner/notes');
	await page.getByRole('button', { name: 'New note' }).click();
	await page.waitForURL(/\/planner\/notes\/\d+\?new=1$/);
	await expect(page.getByLabel('Heading')).toBeFocused();
	await page.getByLabel('Heading').fill(heading);
	await page.getByLabel('Note', { exact: true }).fill('Network: Home\nPassword: correct horse');
	await expect(page.locator('p.status')).toHaveText(/^Saved/, { timeout: 5000 });
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/notes-editor.png`, fullPage: true });

	await page.reload();
	await expect(page.getByLabel('Heading')).toHaveValue(heading);
	await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Network: Home\nPassword: correct horse');
	const noteUrl = page.url().replace(/\?.*$/, '');

	// A second phone opens the same note.
	const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
	await signIn(other);
	await other.goto(noteUrl);
	await expect(other.getByLabel('Note', { exact: true })).toHaveValue(/correct horse/);

	// Phone 1 saves; phone 2's open page refreshes to it (live update).
	await page.getByLabel('Note', { exact: true }).fill('Network: Home\nPassword: battery staple');
	await expect(page.locator('p.status')).toHaveText(/^Saved/, { timeout: 5000 });
	await expect(other.getByLabel('Note', { exact: true })).toHaveValue(/battery staple/, { timeout: 5000 });

	// Phone 2 loses signal and types: kept on the phone. Meanwhile phone 1 saves. Back online,
	// phone 2's save names the old version, so it is refused and both texts are shown.
	await other.context().setOffline(true);
	await other.getByLabel('Note', { exact: true }).fill('From phone two');
	await expect(other.locator('p.status')).toHaveText(/No connection/, { timeout: 5000 });
	await page.getByLabel('Note', { exact: true }).fill('From phone one');
	await expect(page.locator('p.status')).toHaveText(/^Saved/, { timeout: 5000 });
	await other.context().setOffline(false);
	await expect(other.locator('p.status')).toHaveText(/Someone else changed this note/, { timeout: 5000 });
	await expect(other.getByLabel('Note', { exact: true })).toHaveValue('From phone one');
	await expect(other.getByLabel('What you typed')).toHaveValue(/From phone two/);
	if (SHOTS) await other.screenshot({ path: `${SHOTS}/notes-conflict.png`, fullPage: true });
	await other.getByRole('button', { name: 'Use mine instead' }).click();
	await expect(other.locator('p.status')).toHaveText(/^Saved/, { timeout: 5000 });
	await other.close();

	// The list shows it with a preview; an untouched new note is dropped on the way out.
	await page.goto('/planner/notes');
	const row = page.getByRole('link', { name: new RegExp(heading) });
	await expect(row).toContainText('From phone two');
	await page.getByRole('button', { name: 'New note' }).click();
	await page.waitForURL(/\?new=1$/);
	await page.getByRole('link', { name: '← Notes' }).click();
	await page.waitForURL('**/planner/notes');
	await expect(page.getByText('Untitled')).toHaveCount(0);
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/notes-list.png`, fullPage: true });

	// Delete needs the box ticked.
	await row.click();
	await page.getByText('Delete note').click();
	await page.getByRole('button', { name: /^Delete “/ }).click();
	await expect(page.getByText('Tick the box to confirm.')).toBeVisible();
	await page.getByLabel(/Yes, delete it for everyone/).check();
	await page.getByRole('button', { name: /^Delete “/ }).click();
	await page.waitForURL('**/planner/notes');
	await expect(page.getByRole('link', { name: new RegExp(heading) })).toHaveCount(0);
});
