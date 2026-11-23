// Spike stub: serves render JSON, logs webhooks, optionally calls Tesserae push.
import http from 'node:http';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(Boolean).map(l=>l.split(/=(.*)/s).slice(0,2)));
const sample = JSON.parse(fs.readFileSync('spikes/sample-payload.json','utf8'));
let done = new Set(); const rev = {};
let fail = false;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const PUSH = process.env.PUSH_PAGE; // page id to push after a tap
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  log(req.method, req.url, JSON.stringify(req.headers), body.slice(0, 600));
  if (url.pathname === '/test.ics') { const d=new Date(Date.now()+8*3600e3).toISOString().slice(0,10).replace(/-/g,''); res.setHeader('content-type','text/calendar'); res.end(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//t//t//EN', ...[['080000','083000','Daycare drop-off'],['153000','161500','Swimming lesson'],['173000','180000','Dinner at Nana\'s']].map(([a,b,t],i)=>['BEGIN:VEVENT','UID:t'+i+'@x','DTSTAMP:'+d+'T000000Z','DTSTART;TZID=Australia/Perth:'+d+'T'+a,'DTEND;TZID=Australia/Perth:'+d+'T'+b,'SUMMARY:'+t,'END:VEVENT'].join('\r\n')),'END:VCALENDAR'].join('\r\n')); return; }
  if (url.pathname === '/occ') { const o = Number(url.searchParams.get('o')); sample.slots.forEach(x=>x.touch_id='o'+o+'-s'+x.slot); sample.children[0].routine.occurrence_id=o; res.end('ok'); return; }
  if (url.pathname === '/fail') { fail = !fail; res.end(String(fail)); return; }
  if (url.pathname.startsWith('/api/render/sample')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify(sample)); return; }
  if (url.pathname.startsWith('/api/render')) {
    if (fail) { res.writeHead(500); res.end('boom'); return; }
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ generated_at: new Date().toISOString(), steps: [1,2,3].map(i=>({slot:i,title:'Step '+i,done:done.has(i),rev:rev[i]||0})) }));
    return;
  }
  if (url.pathname.startsWith('/hook')) {
    const slot = Number(url.searchParams.get('slot')||1);
    { const st = sample.slots.find(x=>x.slot===slot); if (st) { st.done = !st.done; sample.children[0].routine.done = sample.slots.filter(x=>x.done).length; } }
    done.has(slot) ? done.delete(slot) : done.add(slot); rev[slot]=(rev[slot]||0)+1;
    res.end('{"applied":true}');
    if (PUSH) {
      const t0 = Date.now();
      const r = await fetch('http://localhost:8765/api/v1/push', { method:'POST', headers:{authorization:'Bearer '+env.TESSERAE_PUSH_TOKEN,'content-type':'application/json'}, body: JSON.stringify({page_id: PUSH, device_ids: process.env.PUSH_DEVICE ? [process.env.PUSH_DEVICE] : undefined}) });
      log('PUSH', r.status, await r.text(), (Date.now()-t0)+'ms');
    }
    return;
  }
  res.end('ok');
}).listen(9999, '0.0.0.0', () => log('stub on :9999'));
