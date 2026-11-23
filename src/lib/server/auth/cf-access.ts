import crypto from 'node:crypto';

// Cloudflare Access login (ADR-18). Behind the tunnel, Cloudflare signs a JWT for the person who
// passed the email login and sends it as `Cf-Access-Jwt-Assertion` (also the `CF_Authorization`
// cookie). A valid one counts as an adult session, so hub.example.com needs no Planner PIN.
// The LAN address never carries a valid token, so it still asks for the PIN. Headers can be
// forged on the LAN, which is why the signature, audience, issuer and expiry are all checked.

export type AccessConfig = { teamDomain: string; aud: string };
type Jwk = crypto.JsonWebKey & { kid?: string };
type FetchKeys = (url: string) => Promise<{ keys: Jwk[] }>;

const KEYS_TTL_MS = 60 * 60_000;

const b64url = (s: string) => Buffer.from(s, 'base64url');

export function accessVerifier(cfg: AccessConfig, fetchKeys: FetchKeys = defaultFetch) {
	const issuer = `https://${cfg.teamDomain}`;
	let keys: Map<string, crypto.KeyObject> = new Map();
	let keysAt = 0;
	const seen = new Map<string, { email: string; exp: number }>(); // verified tokens until expiry

	async function key(kid: string, now: number): Promise<crypto.KeyObject | undefined> {
		// Refetch hourly, or straight away for an unknown kid (Cloudflare rotates keys).
		if (!keys.has(kid) || now - keysAt > KEYS_TTL_MS) {
			try {
				const { keys: list } = await fetchKeys(`${issuer}/cdn-cgi/access/certs`);
				keys = new Map(list.filter((k) => k.kid).map((k) => [k.kid!, crypto.createPublicKey({ key: k, format: 'jwk' })]));
				keysAt = now;
			} catch (e) {
				console.warn('[cf-access] could not fetch signing keys:', (e as Error).message);
			}
		}
		return keys.get(kid);
	}

	/** The email of the Access user, or null if the token is missing or not valid for this app. */
	return async function verify(token: string | null | undefined, now = Date.now()): Promise<string | null> {
		if (!token) return null;
		const hit = seen.get(token);
		if (hit) {
			if (hit.exp * 1000 > now) return hit.email;
			seen.delete(token);
		}
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		try {
			const header = JSON.parse(b64url(parts[0]).toString()) as { alg?: string; kid?: string };
			if (header.alg !== 'RS256' || !header.kid) return null;
			const k = await key(header.kid, now);
			if (!k) return null;
			const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), k, b64url(parts[2]));
			if (!ok) return null;
			const p = JSON.parse(b64url(parts[1]).toString()) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
			const auds = Array.isArray(p.aud) ? p.aud : [p.aud];
			const nowS = now / 1000;
			if (!auds.includes(cfg.aud) || p.iss !== issuer || !p.exp || p.exp <= nowS || (p.nbf && p.nbf > nowS + 60) || !p.email) return null;
			if (seen.size > 200) seen.clear();
			seen.set(token, { email: p.email, exp: p.exp });
			return p.email;
		} catch {
			return null;
		}
	};
}

async function defaultFetch(url: string) {
	const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as { keys: Jwk[] };
}

/** The Access token on a request: Cloudflare's header, or its cookie. */
export function accessToken(request: Request, cookie: string | undefined): string | null {
	return request.headers.get('cf-access-jwt-assertion') ?? cookie ?? null;
}
