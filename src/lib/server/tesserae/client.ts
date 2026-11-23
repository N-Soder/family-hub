// Minimal clients for a running Tesserae (verified against 0.475.0).
// - TesseraeAdmin: admin-session form routes + MCP HTTP API (token).
// - FakeDevice: speaks the REST device protocol like a reTerminal E1003
//   (portrait, protocol v2, overlay schema 2, can_stay_awake).

export interface TesseraeConfig {
	baseUrl: string; // e.g. http://localhost:8765
	adminPassword?: string;
	mcpToken?: string;
	pushToken?: string;
}

export class TesseraeAdmin {
	private jar = new Map<string, string>();
	constructor(private cfg: TesseraeConfig) {}

	private get cookie(): string {
		return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	/** Keep every Set-Cookie: Tesserae's signed session cookie changes (e.g. one-time token reveals). */
	private keep(res: Response): Response {
		for (const c of res.headers.getSetCookie()) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
		}
		return res;
	}

	setMcpToken(token: string): void {
		this.cfg.mcpToken = token;
	}

	/** True while Tesserae still shows its first-run password form. */
	async setupPending(): Promise<boolean> {
		const res = await fetch(`${this.cfg.baseUrl}/setup`, { redirect: 'manual' });
		await res.arrayBuffer();
		return res.status === 200;
	}

	async setup(): Promise<void> {
		if (!this.cfg.adminPassword) throw new Error('TESSERAE_ADMIN_PASSWORD not set');
		const res = await fetch(`${this.cfg.baseUrl}/setup`, {
			method: 'POST',
			redirect: 'manual',
			body: new URLSearchParams({ password: this.cfg.adminPassword, password_confirm: this.cfg.adminPassword })
		});
		await res.arrayBuffer();
		if (res.status !== 302) throw new Error(`Tesserae setup failed (${res.status})`);
	}

	async get(path: string): Promise<Response> {
		if (!this.cookie) await this.login();
		const go = async () => this.keep(await fetch(`${this.cfg.baseUrl}${path}`, { headers: { cookie: this.cookie }, redirect: 'manual' }));
		const res = await go();
		// A redirect to /login means the session expired (or Tesserae restarted): log in once more.
		if (res.status === 302 && (res.headers.get('location') ?? '').includes('/login')) {
			await res.arrayBuffer();
			await this.login();
			return go();
		}
		return res;
	}

	async login(): Promise<void> {
		if (!this.cfg.adminPassword) throw new Error('TESSERAE_ADMIN_PASSWORD not set');
		const res = await fetch(`${this.cfg.baseUrl}/login`, {
			method: 'POST',
			redirect: 'manual',
			body: new URLSearchParams({ password: this.cfg.adminPassword, next: '/' })
		});
		await res.arrayBuffer();
		if (res.status !== 302 || res.headers.getSetCookie().length === 0) throw new Error(`Tesserae login failed (${res.status})`);
		this.jar.clear();
		this.keep(res);
	}

	/** POST an admin form route; returns the response (302 on success). */
	async form(path: string, fields: Record<string, string>): Promise<Response> {
		if (!this.cookie) await this.login();
		const res = this.keep(
			await fetch(`${this.cfg.baseUrl}${path}`, {
				method: 'POST',
				redirect: 'manual',
				headers: { cookie: this.cookie },
				body: new URLSearchParams(fields)
			})
		);
		await res.arrayBuffer();
		if (res.status >= 400) throw new Error(`Tesserae ${path} → ${res.status}`);
		return res;
	}

	async adminJson<T>(path: string, body: unknown): Promise<T> {
		if (!this.cookie) await this.login();
		const res = this.keep(
			await fetch(`${this.cfg.baseUrl}${path}`, {
				method: 'POST',
				headers: { cookie: this.cookie, 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		);
		if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
		return (await res.json()) as T;
	}

	async mcp<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
		const headers: Record<string, string> = {};
		if (this.cfg.mcpToken) headers.authorization = `Bearer ${this.cfg.mcpToken}`;
		let payload: BodyInit | undefined;
		if (body instanceof Uint8Array) {
			headers['content-type'] = 'application/gzip';
			payload = body as unknown as BodyInit;
		} else if (body !== undefined) {
			headers['content-type'] = 'application/json';
			payload = JSON.stringify(body);
		}
		const res = await fetch(`${this.cfg.baseUrl}/api/mcp${path}`, { method, headers, body: payload });
		if (!res.ok) throw new Error(`MCP ${method} ${path} → ${res.status} ${await res.text()}`);
		return (raw ? await res.arrayBuffer() : await res.json()) as T;
	}

	/** Global webhook-token push (what Family Hub calls after a tap). */
	async push(pageId: string, deviceIds?: string[]): Promise<{ status: string; duration_s: number; error?: string }> {
		const res = await fetch(`${this.cfg.baseUrl}/api/v1/push`, {
			method: 'POST',
			headers: { authorization: `Bearer ${this.cfg.pushToken}`, 'content-type': 'application/json' },
			body: JSON.stringify({ page_id: pageId, device_ids: deviceIds })
		});
		return (await res.json()) as { status: string; duration_s: number; error?: string };
	}
}

export interface ManifestRegion {
	id: string;
	rect: { x: number; y: number; w: number; h: number };
	gestures: Record<string, unknown>;
}

export class FakeDevice {
	token = '';
	digest = '';
	private eventId = Math.floor(Date.now() / 1000);
	constructor(
		private baseUrl: string,
		public id: string,
		private mac: string
	) {}

	private body() {
		return {
			device_id: this.id,
			kind: 'seeed_reterminal_e1003',
			mac: this.mac,
			panel_w: 1872,
			panel_h: 1404,
			rotation: 90,
			fw_version: 'sim-1.44.0',
			name: `Sim ${this.id}`,
			gamut: 'gray_16'
		};
	}

	private async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
		return fetch(`${this.baseUrl}/api/v1/device/${this.id}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.token}`,
				...(body ? { 'content-type': 'application/json' } : {}),
				...headers
			},
			body: body ? JSON.stringify(body) : undefined
		});
	}

	async register(pairingCode: string): Promise<void> {
		const res = await fetch(`${this.baseUrl}/api/v1/device/register`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-pairing-code': pairingCode },
			body: JSON.stringify(this.body())
		});
		const json = (await res.json()) as { device_token?: string; device_id?: string; error?: string };
		if (!json.device_token) throw new Error(`register failed: ${res.status} ${JSON.stringify(json)}`);
		this.token = json.device_token;
		if (json.device_id) this.id = json.device_id;
	}

	async status(): Promise<Record<string, unknown>> {
		const res = await this.call('POST', '/status', {
			battery_pct: 100,
			rssi: -50,
			fw_version: 'sim-1.44.0',
			proto: { v: 2 },
			overlay: { schema: 2, max_targets: 32 },
			can_stay_awake: true
		});
		return (await res.json()) as Record<string, unknown>;
	}

	/** Poll /frame. Returns true if a new frame digest was received. */
	async frame(): Promise<boolean> {
		const res = await this.call('GET', '/frame', undefined, this.digest ? { 'if-none-match': `"${this.digest}"` } : {});
		if (res.status === 200) {
			const json = (await res.json()) as { render_id: string };
			const changed = json.render_id !== this.digest;
			this.digest = json.render_id;
			return changed;
		}
		await res.arrayBuffer();
		return false;
	}

	async manifest(): Promise<ManifestRegion[]> {
		const res = await this.call('GET', `/frame/manifest?digest=${this.digest}`);
		const json = (await res.json()) as { regions?: ManifestRegion[] };
		return json.regions ?? [];
	}

	async tap(regionId: string): Promise<{ outcome: string }> {
		const res = await this.call('POST', '/tap', {
			digest: this.digest,
			region_id: regionId,
			gesture: 'tap',
			event_id: ++this.eventId
		});
		return (await res.json()) as { outcome: string };
	}

	/** One linger-poll of /frame/data. Returns 'patch' | 'stale' | 'none'. */
	async frameData(): Promise<{ kind: 'patch' | 'stale' | 'none'; json: Record<string, unknown> }> {
		const res = await this.call('GET', `/frame/data?digest=${this.digest}`);
		if (res.status !== 200) {
			await res.arrayBuffer();
			return { kind: 'none', json: { status: res.status } };
		}
		const json = (await res.json()) as Record<string, unknown> & {
			patches?: { url: string; frame_digest: string; seq: number };
			stale?: boolean;
		};
		if (json.patches?.url) {
			// fetching the blob marks the patch delivered
			const blob = await fetch(`${this.baseUrl}${json.patches.url}`, {
				headers: { authorization: `Bearer ${this.token}` }
			});
			await blob.arrayBuffer();
			return { kind: 'patch', json };
		}
		if (json.stale) return { kind: 'stale', json };
		return { kind: 'none', json };
	}
}
