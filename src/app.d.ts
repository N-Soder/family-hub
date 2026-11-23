declare global {
	namespace App {
		interface Locals {
			adult: boolean;
			/** How the adult got in: Planner PIN session or Cloudflare Access login. */
			adultVia: 'pin' | 'cloudflare' | null;
			/** A paired Board screen (ADR-30): its name, else null. */
			board: string | null;
		}
	}
}

export {};
