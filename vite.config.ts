import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
	// Dev: expose .env to server code (production gets real env vars from Compose).
	if (mode === 'development') {
		for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[k] ??= v;
	}
	return {
		plugins: [sveltekit()],
		server: { fs: { allow: ['tesserae'] }, allowedHosts: ['host.docker.internal', 'family-hub'] },
		test: {
			include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
			environment: 'node',
			env: { FAMILY_HUB_NO_HUB: '1', TZ_HOUSEHOLD: 'Australia/Perth' }
		}
	};
});
