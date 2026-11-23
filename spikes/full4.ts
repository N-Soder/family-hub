import fs from 'node:fs';
import { TesseraeAdmin } from '../src/lib/server/tesserae/client';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(Boolean).map(l=>l.split(/=(.*)/s).slice(0,2)));
const t = new TesseraeAdmin({ baseUrl: 'http://localhost:8765', mcpToken: env.TESSERAE_MCP_TOKEN, pushToken: env.TESSERAE_PUSH_TOKEN });
const TOK = fs.readFileSync('spikes/.tok-sim-e1003','utf8'); const H = { authorization: `Bearer ${TOK}` };
const page = process.argv[2];
const man = async () => { const f = await (await fetch('http://localhost:8765/api/v1/device/sim-e1003/frame',{headers:H})).json(); const m = await (await fetch(`http://localhost:8765/api/v1/device/sim-e1003/frame/manifest?digest=${f.render_id}`,{headers:H})).json(); return `${f.render_id} ids=${m.regions.slice(0,2).map((r:any)=>r.id).join(',')}`; };
await fetch('http://localhost:9999/occ?o=8'); await t.mcp('POST', `/pages/${page}/push`, { device_ids: ['sim-e1003'] }); console.log('occ 8, mcp only →', await man());
await fetch('http://localhost:9999/occ?o=9'); await t.push(page, ['sim-e1003']); await t.mcp('POST', `/pages/${page}/push`, { device_ids: ['sim-e1003'] }); console.log('occ 9, webhook+mcp →', await man());
