import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessToken, accessVerifier } from '../../src/lib/server/auth/cf-access';

const TEAM = 'yourteam.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const NOW = Date.parse('2026-10-31T08:00:00Z');
const nowS = NOW / 1000;

function keypair(kid: string) {
	const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
	return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' } };
}
const good = keypair('k1');
const other = keypair('k2');

const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims: object, key = good, header: object = { alg: 'RS256', kid: key.kid }) {
	const body = `${enc(header)}.${enc(claims)}`;
	return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key.privateKey).toString('base64url')}`;
}
const claims = (over: object = {}) => ({ aud: [AUD], iss: `https://${TEAM}`, email: 'you@example.com', exp: nowS + 3600, nbf: nowS - 10, ...over });

function verifier(keys = [good.jwk]) {
	const calls: string[] = [];
	const verify = accessVerifier({ teamDomain: TEAM, aud: AUD }, async (url) => {
		calls.push(url);
		return { keys };
	});
	return { verify, calls };
}

describe('Cloudflare Access login token', () => {
	it('accepts a token Cloudflare signed for this app and returns the email', async () => {
		const { verify, calls } = verifier();
		expect(await verify(sign(claims()), NOW)).toBe('you@example.com');
		expect(calls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
	});

	it('rejects tokens for another app, another team, expired, or not yet valid', async () => {
		const { verify } = verifier();
		expect(await verify(sign(claims({ aud: ['b'.repeat(64)] })), NOW)).toBeNull();
		expect(await verify(sign(claims({ iss: 'https://evil.cloudflareaccess.com' })), NOW)).toBeNull();
		expect(await verify(sign(claims({ exp: nowS - 1 })), NOW)).toBeNull();
		expect(await verify(sign(claims({ nbf: nowS + 3600 })), NOW)).toBeNull();
		expect(await verify(sign(claims({ email: undefined })), NOW)).toBeNull();
	});

	it('rejects forged tokens: wrong key, edited claims, alg none, garbage, missing', async () => {
		const { verify } = verifier();
		// Signed by a key Cloudflare does not publish, but claiming its kid.
		expect(await verify(sign(claims(), other, { alg: 'RS256', kid: 'k1' }), NOW)).toBeNull();
		// A real token with the email swapped.
		const [h, , s] = sign(claims()).split('.');
		expect(await verify(`${h}.${enc(claims({ email: 'intruder@example.com' }))}.${s}`, NOW)).toBeNull();
		expect(await verify(`${enc({ alg: 'none', kid: 'k1' })}.${enc(claims())}.`, NOW)).toBeNull();
		expect(await verify('not-a-jwt', NOW)).toBeNull();
		expect(await verify('', NOW)).toBeNull();
		expect(await verify(null, NOW)).toBeNull();
	});

	it('refetches keys when Cloudflare rotates to an unknown kid', async () => {
		let published = [good.jwk];
		const calls: string[] = [];
		const verify = accessVerifier({ teamDomain: TEAM, aud: AUD }, async (url) => (calls.push(url), { keys: published }));
		expect(await verify(sign(claims()), NOW)).not.toBeNull();
		published = [good.jwk, other.jwk];
		expect(await verify(sign(claims(), other), NOW)).toBe('you@example.com');
		expect(calls).toHaveLength(2);
	});

	it('fails closed when the keys cannot be fetched', async () => {
		const verify = accessVerifier({ teamDomain: TEAM, aud: AUD }, async () => {
			throw new Error('offline');
		});
		expect(await verify(sign(claims()), NOW)).toBeNull();
	});

	it('a verified token stops working when it expires', async () => {
		const { verify } = verifier();
		const t = sign(claims({ exp: nowS + 60 }));
		expect(await verify(t, NOW)).not.toBeNull();
		expect(await verify(t, NOW + 61_000)).toBeNull();
	});

	it('reads the token from the Cloudflare header first, then the cookie', () => {
		const req = (h?: string) => new Request('http://x/planner', { headers: h ? { 'cf-access-jwt-assertion': h } : {} });
		expect(accessToken(req('from-header'), 'from-cookie')).toBe('from-header');
		expect(accessToken(req(), 'from-cookie')).toBe('from-cookie');
		expect(accessToken(req(), undefined)).toBeNull();
	});
});
