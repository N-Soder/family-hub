import { z } from 'zod';

// Every environment variable the app reads, validated once. See .env.example.
const schema = z.object({
	DATABASE_PATH: z.string().default('./data/family-hub.db'),
	// Daily and pre-migration backups. Unset = `backups/` next to the database.
	BACKUP_DIR: z.string().optional(),
	TZ_HOUSEHOLD: z.string().default('Australia/Perth'),
	DAY_ROLLOVER: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
		.default('03:00'),
	ADMIN_PIN: z
		.string()
		.regex(/^\d{6,12}$/, 'ADMIN_PIN must be 6–12 digits')
		.optional(),
	// Where Tesserae reaches this app (used in page definitions and webhook URLs).
	APP_BASE_URL_FOR_TESSERAE: z.string().url().default('http://family-hub:3000'),
	TESSERAE_URL: z.string().url().optional(),
	TESSERAE_ADMIN_PASSWORD: z.string().min(8).optional(),
	TESSERAE_PUSH_TOKEN: z.string().min(16).optional(),
	TESSERAE_MCP_TOKEN: z.string().optional(),
	TESSERAE_AUTO_BOOTSTRAP: z
		.enum(['true', 'false'])
		.default('false')
		.transform((v) => v === 'true'),
	// Seed the demo household on first start (empty database). Compose sets it.
	SEED_ON_EMPTY: z
		.enum(['true', 'false'])
		.default('false')
		.transform((v) => v === 'true'),
	// Cloudflare Access (ADR-18): with both set, a valid Access login replaces the Planner PIN on
	// the public hostname. Team domain like `yourteam.cloudflareaccess.com`; AUD from the app.
	CF_ACCESS_TEAM_DOMAIN: z
		.string()
		.regex(/^[a-z0-9-]+\.cloudflareaccess\.com$/, 'e.g. myteam.cloudflareaccess.com')
		.optional(),
	CF_ACCESS_AUD: z.string().regex(/^[a-f0-9]{64}$/, '64 hex characters').optional(),
	// Tesserae's calendar_core plugin folder, mounted read-only: the Planner's Today tab reads the
	// same feeds as the wall (ADR-19). Unset = no calendar on the phone.
	CALENDAR_DIR: z.string().optional(),
	SIM_DEVICE_ID: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/).default('sim-wall')
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
	if (!cached) cached = schema.parse(process.env);
	return cached;
}

/** Tests override the environment between cases. */
export function resetEnv(): void {
	cached = null;
}
