import { defineConfig } from '@playwright/test';

// E2E_BASE_URL=http://localhost:3000 runs against an already running stack
// (e.g. `docker compose up`) instead of starting the production build.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 90_000,
	// One shared database: the files run one after another (board, kid-view, sim-flow).
	workers: 1,
	use: { baseURL: external ?? 'http://localhost:4173', viewport: { width: 1280, height: 900 } },
	webServer: external ? undefined : {
		command: './scripts/e2e-server.sh',
		url: 'http://localhost:4173/healthz',
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: 'pipe'
	}
});
