// Render static/icons/storybook.svg to the PNG sizes phones need. Run after editing the SVG:
//   npx tsx scripts/make-icons.ts
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const svg = fs.readFileSync('static/icons/storybook.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
	await page.screenshot({ path: `static/icons/storybook-${size}.png`, omitBackground: false });
}
await browser.close();
console.log('icons written to static/icons/');
