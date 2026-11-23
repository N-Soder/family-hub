import fs from 'node:fs';
import { TesseraeAdmin } from '../src/lib/server/tesserae/client';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(Boolean).map(l=>l.split(/=(.*)/s).slice(0,2)));
const base='http://localhost:8765', id='sim-e1003', token=fs.readFileSync(`spikes/.tok-${id}`,'utf8');
const H={authorization:`Bearer ${token}`};
const admin = new TesseraeAdmin({baseUrl:base, adminPassword: env.TESSERAE_ADMIN_PASSWORD, mcpToken: env.TESSERAE_MCP_TOKEN, pushToken: env.TESSERAE_PUSH_TOKEN});
const page=process.argv[2]; const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let digest='';
const frame=async()=>{const r=await fetch(`${base}/api/v1/device/${id}/frame`,{headers:H}); const j=await r.json(); digest=j.render_id; return digest;};
const fd=async()=>{const j=await (await fetch(`${base}/api/v1/device/${id}/frame/data?digest=${digest}`,{headers:H})).json(); if(j.patches?.url) await (await fetch(base+j.patches.url,{headers:H})).arrayBuffer(); return j.stale?'STALE(full frame)':j.patches?`patch seq ${j.patches.seq}`:'none';};
const toggle=async(s:number)=>{await fetch(`http://localhost:9999/hook?slot=${s}`,{method:'POST'});};
console.log('start', await frame());
await toggle(1); console.log('webhook push', (await admin.push(page,[id])).status, await fd());
await toggle(1); console.log('mcp push', JSON.stringify(await admin.mcp('POST',`/pages/${page}/push`,{device_ids:[id]})), await fd());
await frame();
await toggle(1); let t0=Date.now(); const r=await admin.form('/send/page',{page_id:page}); console.log('send/page', r.status);
for(let i=0;i<40;i++){const s=await fd(); if(s!=='none'){console.log('send/page →', s, Date.now()-t0,'ms'); break;} await sleep(100);}
