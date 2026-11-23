// Standalone fallback view. The wall page paints this widget's data from a code
// element instead (tesserae/paint/routine.js); this keeps the widget usable alone.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export default function render(shadow, ctx) {
  const d = ctx?.data ?? {};
  if (d.error && !d.payload) {
    shadow.innerHTML = `<div style="font:600 28px sans-serif;padding:16px">Family Hub offline</div>`;
    return;
  }
  const p = d.payload ?? {};
  const rows = (p.slots ?? [])
    .map((s) => `<div style="font:600 32px sans-serif;padding:8px 0;${s.done ? 'color:#888;text-decoration:line-through' : ''}">${s.done ? '■' : '□'} ${esc(s.title)}</div>`)
    .join('');
  const r = p.children?.[0]?.routine;
  shadow.innerHTML = `<div style="padding:16px"><div style="font:800 40px sans-serif">${esc(r?.name ?? 'No routine now')}</div>${rows}</div>`;
}
