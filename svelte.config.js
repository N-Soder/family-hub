import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// Kit's origin check assumes https:// without ORIGIN set, which breaks plain-HTTP
		// LAN access from phones. hooks.server.ts does an equivalent same-host check.
		// `trustedOrigins: ['*']` is how Kit 2.70+ turns its own check off (checkOrigin is deprecated).
		csrf: { trustedOrigins: ['*'] }
	},
	compilerOptions: { runes: true }
};

export default config;
