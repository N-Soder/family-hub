import fs from 'node:fs';
const base='http://localhost:8765', id='sim-e1003', token=fs.readFileSync(`spikes/.tok-${id}`,'utf8');
const H={authorization:`Bearer ${token}`,'content-type':'application/json'};
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(Boolean).map(l=>l.split(/=(.*)/s).slice(0,2)));
const page = process.argv[2];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let digest=''; let seq=0;
const frame=async()=>{const r=await fetch(`${base}/api/v1/device/${id}/frame`,{headers:{...H,...(digest?{'if-none-match':`"${digest}"`}:{})}}); if(r.status===200){const j=await r.json(); const ch=j.render_id!==digest; digest=j.render_id; seq=0; return ch?'NEW FRAME '+digest:'same';} return String(r.status);};
const poll=async()=>{const j=await (await fetch(`${base}/api/v1/device/${id}/frame/data?digest=${digest}`,{headers:H})).json(); if(j.stale){return 'stale → '+await frame();} if(j.patches?.seq>seq){await (await fetch(base+j.patches.url,{headers:H})).arrayBuffer(); seq=j.patches.seq; return `APPLY patch rects=${JSON.stringify(j.patches.rects.map((r:any)=>[r.x,r.y,r.w,r.h]))}`;} return 'nothing new';};
const push=async()=> (await (await fetch(`${base}/api/v1/push`,{method:'POST',headers:{authorization:`Bearer ${env.TESSERAE_PUSH_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({page_id:page,device_ids:[id]})})).json()).status;
const toggle=async(slot:number)=>{await fetch(`http://localhost:9999/hook?slot=${slot}`,{method:'POST'});};
console.log('baseline push', await push(), await frame(), '|', await poll());
for (const [label, slot] of [['tick1',1],['untick1',1],['tick1',1],['tick2',2],['untick1',1],['untick2',2]] as const) {
  await toggle(slot); const p=await push(); await sleep(200);
  console.log(label.padEnd(8), 'push', p, '| poll:', await poll(), '| poll again:', await poll());
}
