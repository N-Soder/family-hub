import fs from 'node:fs';
import { TesseraeAdmin } from '../src/lib/server/tesserae/client';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(Boolean).map(l=>l.split(/=(.*)/s).slice(0,2)));
const t = new TesseraeAdmin({ baseUrl: 'http://localhost:8765', mcpToken: env.TESSERAE_MCP_TOKEN, pushToken: env.TESSERAE_PUSH_TOKEN });
const TOK = fs.readFileSync('spikes/.tok-sim-e1003','utf8'); const H = { authorization: `Bearer ${TOK}` };
const page = process.argv[2];
const man = async () => { const f = await (await fetch('http://localhost:8765/api/v1/device/sim-e1003/frame',{headers:H})).json(); const m = await (await fetch(`http://localhost:8765/api/v1/device/sim-e1003/frame/manifest?digest=${f.render_id}`,{headers:H})).json(); return `${f.render_id} regions=${m.regions.length}`; };
await t.push(page, ['sim-e1003']); console.log('baseline', await man());
for (const slot of [3, 3, 2]) {
  await fetch(`http://localhost:9999/hook?slot=${slot}`, { method: 'POST' });
  let t0 = Date.now(); const p = await t.push(page, ['sim-e1003']); const a = Date.now()-t0;
  t0 = Date.now(); await t.mcp('POST', `/pages/${page}/push`, { device_ids: ['sim-e1003'] }); const b = Date.now()-t0;
  console.log(`toggle ${slot}: webhook push ${p.status} ${a}ms, mcp push ${b}ms →`, await man());
}
