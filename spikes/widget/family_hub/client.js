export default function render(shadow, ctx) {
  const d = ctx?.data ?? {};
  if (d.error) { shadow.innerHTML = `<div style="font:48px sans-serif">Hub offline: ${d.error}</div>`; return; }
  const p = d.payload ?? {};
  const rows = (p.steps ?? []).map(s => `<div style="height:160px;font:64px sans-serif;border-bottom:4px solid #000">${s.done ? '☑' : '☐'} ${s.title}</div>`).join('');
  shadow.innerHTML = `<div>${d.stale ? '<div style="font:40px sans-serif">STALE</div>' : ''}${rows}<div style="font:32px sans-serif">fetch ${d.ms}ms ${p.generated_at}</div></div>`;
}
