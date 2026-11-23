import fs from 'node:fs';
import { TesseraeAdmin, FakeDevice } from '../src/lib/server/tesserae/client';
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const base = 'http://localhost:8765';
const admin = new TesseraeAdmin({ baseUrl: base, adminPassword: env.TESSERAE_ADMIN_PASSWORD, mcpToken: env.TESSERAE_MCP_TOKEN, pushToken: env.TESSERAE_PUSH_TOKEN });
const pageId = process.argv[2];
const devId = process.argv[3] ?? 'sim-e1003';
const runs = Number(process.argv[4] ?? 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dev = new FakeDevice(base, devId, 'aa:bb:cc:dd:ee:01');
const tokFile = `spikes/.tok-${devId}`;
if (fs.existsSync(tokFile)) dev.token = fs.readFileSync(tokFile, 'utf8');
else {
	const { code } = await admin.adminJson<{ code: string }>('/api/v1/device/admin/pairing/issue', { note: 'spike' });
	await dev.register(code);
	fs.writeFileSync(tokFile, dev.token);
}
console.log('device', dev.id);
const st = await dev.status();
console.log('status config', JSON.stringify(st.config).slice(0, 300), 'next_poll_s', st.next_poll_s);
console.log('bind', await admin.mcp('POST', `/pages/${pageId}/devices`, { device_ids: [dev.id] }));
console.log('push', await admin.push(pageId, [dev.id]));
await dev.frame();
console.log('digest', dev.digest);
const regions = await dev.manifest();
console.log('regions', regions.map((r) => `${r.id}@${r.rect.y}`).join(' '));
const results: number[] = []; let lastSeq = 0; { await dev.frame(); const d = await dev.frameData(); lastSeq = Number((d.json as any).patches?.seq ?? 0); }
for (let i = 0; i < runs; i++) {
	await dev.frame();
	const t0 = performance.now(); const tapEpoch = Date.now();
	const tap = await dev.tap(regions[0].id);
	const tTap = performance.now() - t0;
	let got = '';
	while (performance.now() - t0 < 15000) {
		const d = await dev.frameData();
		const seq = Number((d.json as any).patches?.seq ?? (d.json as any).seq ?? 0);
		if (d.kind === 'patch') { /* track */ } if (d.kind === 'stale' || (d.kind === 'patch' && seq > lastSeq)) { got = d.kind; if (d.kind==='patch') lastSeq = seq; break; }
		await sleep(100);
	}
	const total = performance.now() - t0;
	if (got === 'stale') await dev.frame();
	console.log(`run ${i}: tap→${tap.outcome} ${tTap.toFixed(0)}ms; ${got || 'TIMEOUT'} at ${total.toFixed(0)}ms`);
	if (got) results.push(total);
	await sleep(4000); { const d = await dev.frameData(); lastSeq = Math.max(lastSeq, Number((d.json as any).patches?.seq ?? 0)); }
}
results.sort((a, b) => a - b);
if (results.length) console.log('median', results[Math.floor(results.length / 2)].toFixed(0), 'p95', results[Math.min(results.length - 1, Math.ceil(results.length * 0.95) - 1)].toFixed(0), 'n', results.length);
