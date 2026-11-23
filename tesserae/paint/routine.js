/* Family Hub wall painter.
 * Runs in two places with the same markup:
 *  - inside the Tesserae code element (sandboxed iframe, no network), and
 *  - in /sim (browser).
 * Expects globals LAYOUT (tesserae/pages/layout.json) and ICONS (icons.json),
 * prepended by the page builder / sim. Checkboxes carry data-on-tap="@slotN", which
 * Tesserae resolves through the element's `actions` map (config origin).
 *
 * Home: the top half is today (one date + day type, the weather band, TODAY from every
 * calendar beside TO DO: urgent list items, overdue / due within a week / flagged Now, tap to
 * tick); the bottom half is the AGENDA (every day, empty ones as just the date) · a quiet footer.
 * Top right: the page strip when the buttons have more than one page to step through (none
 * since ADR-35: Home only). The wall has no touch (ADR-28). Routines: a tab
 * per child or baby (showing progress) and the chosen one's
 * checklist, or a baby's day plan (a read-only timetable, SPEC §12.3, whose times follow the
 * ticks made on phones). Lists: the first two shared lists with a tap-to-tick box per item.
 * Rules (SPEC §8): black text, heavy outlines, no colour, no motion, legible at 2 m.
 * Look (docs/design.md): Storybook fonts, two-tone icons, soft grey rows, round tick boxes.
 * One date per screen, one heading style, one time format; past events drop off;
 * empty sections collapse; people are marked by their glyph, not by repeating names. */
function fhEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* Two-tone icon from ICONS (Phosphor duotone, scripts/build-icons.ts). E-paper rules
 * (docs/design.md): solid greys on the panel's 16 steps, never opacity (it dithers into
 * speckle); the bold outline below 64 px. tone: '' (black on grey), 'muted' (done), 'white', 'solid' (black back layer: extreme UV). */
function fhGlyph(name, size, tone) {
  var i = ICONS[name] || ICONS.star;
  var fg = tone === 'muted' ? '#999999' : tone === 'white' ? '#ffffff' : '#000000';
  var bg = tone === 'muted' ? '#dddddd' : tone === 'solid' ? '#000000' : '#aaaaaa';
  var d = size < 64 && i.bold ? i.bold : i.fg;
  var s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 256 256" aria-hidden="true">';
  if (i.bg && tone !== 'white') s += '<path d="' + i.bg + '" fill="' + bg + '"/>';
  if (d) s += '<path d="' + d + '" fill="' + fg + '"/>';
  if (i.stroke) s += '<path d="' + i.stroke + '" fill="none" stroke="' + fg + '" stroke-width="' + (size < 64 ? 24 : 16) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  return s + '</svg>';
}
/* Fonts (docs/design.md): Fraunces for the date and headings, Outfit for the rest, cached in
 * Tesserae as "FH Fraunces" / "FH Outfit" (one variable face each). The weight goes through
 * font-variation-settings; font-weight is set too so the fallbacks still get bold. */
var FH_SERIF = '"FH Fraunces","Atkinson Hyperlegible",Georgia,serif';
var FH_SANS = '"FH Outfit","Atkinson Hyperlegible",Arial,sans-serif';
function fhSerif(w) { return 'font-family:' + FH_SERIF + ';font-weight:' + w + ";font-variation-settings:'wght' " + w + ",'SOFT' 100,'WONK' 1;"; }
function fhSans(w) { return 'font-family:' + FH_SANS + ';font-weight:' + w + ";font-variation-settings:'wght' " + w + ';'; }
function fhPossessive(name) {
  return name ? name + (/s$/i.test(name) ? '’ ' : '’s ') : '';
}
/** Calendar titles can arrive prefixed with the feed's symbol (e.g. a calendar emoji); drop it. */
function fhTitle(s) {
  return String(s == null ? '' : s).replace(/^[^\p{L}\p{N}]+/u, '').trim();
}
var FH_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var FH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fhTimeFmt(tz) {
  try {
    var f = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined });
    return function (iso) { return f.format(new Date(iso)).replace(/\s/g, ' '); };
  } catch (e) {
    return function () { return ''; };
  }
}
/** The same event in two calendars (family + child) counts once. */
function fhDedupe(evs) {
  var seen = {};
  return evs.filter(function (e) {
    var k = fhTitle(e.summary).toLowerCase() + '|' + e.start;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}
function fhHeading(label, meta) {
  return '<div class="fh-h"><span>' + label + '</span>' + (meta ? '<span class="fh-meta">' + meta + '</span>' : '') + '</div>';
}

/* TODAY: every calendar in one list (Tesserae's calendar_day data). All-day events share one
 * line; the child's own events (from the calendar named after them) carry their glyph.
 * Shows as much of the day as fits in `rows` lines: everything still to come first, then
 * earlier events (greyed) back to the start of the day. Collapses when the day is empty. */
/** Where an event is, short: the part before the first comma ("Royal Albert Hall, Kensington…" → "Royal Albert Hall"). */
function fhWhere(e) {
  var w = String((e && e.location) || '').split(/[,\n]/)[0].trim();
  return w ? '<span class="fh-loc"> \u00b7 ' + fhEsc(w) + '</span>' : '';
}
var FH_EV_ROW = 67; // px per event line (46 px text, 1.2 line height, 6 px padding)
function fhToday(h, p, child, today, rows, always) {
  var evs = fhDedupe((today && today.events) || []);
  var now = Date.parse(p.generated_at) || Date.now();
  var t = fhTimeFmt(p.tz);
  var mine = function (e) { return child && e.feed && String(e.feed).toLowerCase() === String(child.name).toLowerCase(); };
  var mark = function (e) { return mine(e) ? '<span class="fh-mine">' + fhGlyph(child.icon || 'star', 40) + '</span>' : ''; };
  var allDay = evs.filter(function (e) { return e.all_day; });
  var timed = evs.filter(function (e) { return !e.all_day; })
    .sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
  if (!allDay.length && !timed.length) {
    if (always) h.push('<section class="fh-sec">' + fhHeading('Today') + '<div class="fh-quiet">Nothing on today</div></section>');
    return;
  }
  var ended = function (e) { return Date.parse(e.end || e.start) <= now; };
  var left = Math.max(1, rows - (allDay.length ? 1 : 0));
  var upcoming = timed.filter(function (e) { return !ended(e); });
  var past = timed.filter(ended);
  var more = 0;
  if (upcoming.length > left) { more = upcoming.length - (left - 1); upcoming = upcoming.slice(0, left - 1); past = []; }
  else past = past.slice(Math.max(0, past.length - (left - upcoming.length)));
  h.push('<section class="fh-sec">' + fhHeading('Today'));
  if (allDay.length) {
    h.push('<div class="fh-ev fh-allday"><span class="fh-when">All day</span><span class="fh-what">' +
      allDay.map(function (e) { return mark(e) + fhEsc(fhTitle(e.summary)); }).join('<i> \u00b7 </i>') + '</span></div>');
  }
  past.concat(upcoming).forEach(function (e) {
    var cls = ended(e) ? ' fh-past' : Date.parse(e.start) <= now ? ' fh-now' : '';
    h.push('<div class="fh-ev' + cls + '"><span class="fh-when">' + (cls === ' fh-now' ? 'Now' : fhEsc(t(e.start))) + '</span>' +
      '<span class="fh-what">' + mark(e) + fhEsc(fhTitle(e.summary)) + fhWhere(e) + '</span></div>');
  });
  if (more) h.push('<div class="fh-ev fh-more"><span class="fh-when"></span><span class="fh-what">+' + more + ' more later</span></div>');
  h.push('</section>');
}

/* The child's checklist. The whole row is the tap target (owner, 2026-11-02: easier for small
 * hands than the circle alone). Tesserae's tap feedback inverts the whole row for a moment. */
function fhChecklist(h, V, p, child, r, mode) {
  var meta;
  if (r.all_done) meta = fhGlyph('star', 40) + ' All done!';
  else if (mode === 'picture') {
    meta = '<span class="fh-dots">';
    for (var i = 0; i < r.total && i < 12; i++) meta += '<b class="' + (i < r.done ? 'on' : '') + '"></b>';
    meta += '</span>';
  } else meta = r.done + ' of ' + r.total;
  h.push('<section class="fh-sec fh-bottom">' + fhHeading(fhEsc(fhPossessive(child.name) + r.name), meta));
  var box = V.rowH - 40;
  (p.slots || []).forEach(function (s) {
    h.push('<div class="fh-row' + (s.done ? ' done' : '') + '" data-slot="' + s.slot + '" data-hit="1" data-on-tap="@slot' + s.slot +
      '" data-touch-id="' + fhEsc(s.touch_id) + '" style="height:' + V.rowH +
      'px;margin-bottom:' + V.gap + 'px;gap:' + (mode === 'picture' ? 32 : 28) + 'px">');
    h.push('<div class="fh-check" style="width:' + box + 'px;height:' + box + 'px">' + (s.done ? fhGlyph('check', box - 44, 'white') : '') + '</div>');
    h.push('<div class="fh-g" style="width:' + V.glyph + 'px;height:' + V.glyph + 'px">' + fhGlyph(s.icon || 'star', V.glyph, s.done ? 'muted' : '') + '</div>');
    h.push('<div class="fh-t" style="font-size:' + V.title + 'px">' + fhEsc(s.title) + '</div>');
    h.push('</div>');
  });
  h.push('</section>');
}

/* COMING UP: every day after today, empty ones too (just the date), as many as fit (fhFit
 * trims to whole days). Data is Tesserae's calendar_month (rolling 3 weeks from this Monday), so
 * days up to and including today are skipped: today has its own section. */
function fhIsoDay(d) { return String(d && d.date).slice(0, 10); }
function fhWeekday(iso) { // 0 = Mon, as FH_DAYS
  var x = String(iso).split('-');
  return (new Date(Date.UTC(+x[0], +x[1] - 1, +x[2])).getUTCDay() + 6) % 7;
}
function fhComingUp(h, p, child, r, week, fill, agenda) {
  // fill: a strip between TODAY and the checklist; it disappears when no day fits.
  // agenda (home): every day, empty ones as just the date, up to 4 lines each, plus dated list items.
  if (fill && !(week && week.days)) return;
  var dueOn = {};
  if (agenda) (p.agenda_due || []).forEach(function (d) { (dueOn[d.date] = dueOn[d.date] || []).push(d.title); });
  var perDay = agenda ? 4 : 2;
  var meta = [];
  child = child || {};
  if (r && r.all_done) meta.push(fhGlyph('check', 36) + ' ' + fhEsc(r.name) + ' done');
  if (child.next) meta.push('Next: ' + fhEsc(child.next.name) + ' ' + fhEsc(child.next.start));
  h.push('<section class="fh-sec fh-grow fh-fit' + (fill ? ' fh-fill' : '') + (agenda ? ' fh-agenda' : '') + '">' + fhHeading(agenda ? 'Agenda' : 'Coming up', fill ? '' : meta.join(' · ')));
  var all = (week && week.days) || [];
  var ti = -1;
  all.forEach(function (d, i) { if (d.is_today) ti = i; });
  var days = all.slice(ti + 1);
  var t = fhTimeFmt(p.tz);
  var shown = 0;
  days.forEach(function (d) {
    var date = fhIsoDay(d);
    var evs = fhDedupe((d.events || []).filter(function (e) {
      // A multi-day event that started earlier shows once, on the first day listed.
      var cont = e.continued != null ? e.continued : (e.all_day && String(e.start).slice(0, 10) < date);
      return !(cont && shown > 0);
    }));
    evs.sort(function (a, b) { return (b.all_day ? 1 : 0) - (a.all_day ? 1 : 0) || Date.parse(a.start) - Date.parse(b.start); });
    var lines = evs.map(function (e) {
      return '<div class="fh-wk-ev">' + (e.all_day ? '' : '<b>' + fhEsc(t(e.start)) + '</b> ') + fhEsc(fhTitle(e.summary)) + fhWhere(e) + '</div>';
    }).concat((dueOn[date] || []).map(function (title) {
      return '<div class="fh-wk-ev fh-wk-due">' + fhGlyph('list', 38) + fhEsc(title) + '</div>';
    }));
    // Empty days show too, as just the date (owner 2026-11-14, as COMING UP always has): a gap
    // in the dates read as a missing day.
    if (lines.length > perDay) {
      // The last line shown says how many more.
      var extra = lines.length - perDay;
      lines = lines.slice(0, perDay);
      lines[perDay - 1] = lines[perDay - 1].replace(/<\/div>$/, '<i> +' + extra + ' more</i></div>');
    }
    var parts = date.split('-');
    h.push('<div class="fh-wk-row"><div class="fh-wk-day"><b>' + FH_DAYS[fhWeekday(date)] + '</b><span>' + Number(parts[2]) + ' ' +
      FH_MONTHS[Number(parts[1]) - 1] + '</span></div><div class="fh-wk-evs">' + lines.join('') + '</div></div>');
    shown++;
  });
  if (!shown && fill) { h.pop(); return; }
  if (!shown) h.push('<div class="fh-quiet">' + (week && week.error ? 'Calendar unavailable' : (week ? 'Nothing on in the next few weeks' : (agenda ? 'The agenda shows here on the wall' : 'The week shows here on the wall'))) + '</div>');
  h.push('</section>');
}

/* Today's weather (home, ADR-36, owner 2026-11-14): the day in four blocks — Morning, Midday,
 * Arvo, Evening — because the wall paints once a day (ADR-34) and "now" at 6 am said nothing about
 * the afternoon. Each block: its name and hours, the sky icon beside the temperature at the same
 * height, a word, then chips: wind always (where it comes from, a divider, 1–3 wavy lines for
 * strength), rain from 30 %, UV from 6. Chips follow one rule: light wind is grey, an outline is
 * worth knowing, black is take notice (strong wind, rain 85 %+, UV 11+). Family Hub works out the
 * blocks (src/lib/server/weather.ts); the painter only draws them. The band never scales. */
function fhWaves(n) {
  var ys = n === 1 ? [20] : n === 2 ? [13, 27] : [8, 20, 32], g = '';
  for (var i = 0; i < ys.length; i++) {
    var x = n === 3 ? [8, 2, 6][i] : 4;
    g += '<path d="M' + x + ' ' + ys[i] + 'q9 -8 18 0t18 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>';
  }
  return '<svg width="50" height="40" viewBox="0 0 50 40" aria-hidden="true">' + g + '</svg>';
}
function fhChip(level, inner) {
  return '<span class="fh-chip' + (level === 3 ? ' hot' : level === 1 ? ' quiet' : '') + '">' + inner + '</span>';
}
function fhWeather(h, p) {
  var w = p.weather;
  if (!w || !w.blocks || !w.blocks.length) return;
  h.push('<section class="fh-wx">' + w.blocks.map(function (b) {
    var chips = [];
    if (b.wind) chips.push(fhChip(b.wind.level, '<b>' + fhEsc(b.wind.from) + '</b><i></i>' + fhWaves(b.wind.level)));
    if (b.rain) chips.push(fhChip(b.rain.level === 3 ? 3 : 2, fhGlyph('rainHigh', 36, b.rain.level === 3 ? 'white' : '') + Number(b.rain.pct) + '%'));
    if (b.uv) chips.push(fhChip(b.uv.level === 3 ? 3 : 2, fhGlyph('sun', 36, b.uv.level === 3 ? 'white' : '') + 'UV ' + Number(b.uv.index)));
    return '<div class="fh-wx-b"><div class="fh-wx-when"><b>' + fhEsc(b.name) + '</b><small>' + fhEsc(b.hours) + '</small></div>' +
      '<div class="fh-wx-sky">' + fhGlyph(b.icon, 104) + '<b>' + Number(b.temp) + '°</b></div>' +
      '<div class="fh-wx-word">' + fhEsc(b.label) + '</div><div class="fh-wx-chips">' + chips.join('') + '</div></div>';
  }).join('') + '</section>');
}

/* The page strip, top right on every screen (ADR-28): the stops the front buttons step through,
 * the one shown in black. Not painted while Home is the only stop (ADR-35). */
function fhPages(p) {
  var pages = p.pages || [];
  if (pages.length < 2) return '';
  return '<div class="fh-pages"><div>' + pages.map(function (g) {
    return '<span class="fh-page' + (g.on ? ' on' : '') + '">' + fhEsc(g.label) + '</span>';
  }).join('') + '</div></div>';
}

/* The Lists / Back button (touch walls, before ADR-28). Not painted any more. */
function fhNav(L, p) {
  if (!p.nav) return '';
  var lists = p.nav.to === 'lists';
  return '<div class="fh-nav" data-hit="1" data-slot="' + L.navSlot + '" data-on-tap="@nav" data-touch-id="' + fhEsc(p.nav.touch_id) + '">' +
    fhGlyph(lists ? 'list' : 'back', 52) + '<span>' + (lists ? 'Lists' : 'Back') + '</span></div>';
}

/* The Routines button, left of Lists on the home screen (`@routines`). Under the label: what
 * is on ("Juno asleep since 9:52 am", "Nora to do"), so anyone walking past knows. */
function fhRoutinesNav(L, p) {
  var n = p.routines_nav;
  if (!n) return '';
  return '<div class="fh-nav' + (n.sub ? ' fh-nav2' : '') + '" data-hit="1" data-slot="' + L.routinesSlot + '" data-on-tap="@routines" data-touch-id="' + fhEsc(n.touch_id) + '">' +
    fhGlyph('sun', 52) + '<span>Routines' + (n.sub ? '<small>' + fhEsc(n.sub) + '</small>' : '') + '</span></div>';
}

/* TO DO on home: urgent list items to read, not tap (owner, 2026-11-02: ticking is on the Lists
 * screen). A bullet each; due ones carry a chip, late ones are black. */
function fhTodo(h, L, p) {
  var V = L.home;
  var T = p.todo || { items: [], more: 0 };
  var open = T.items.filter(function (i) { return !i.done; }).length + (T.more || 0);
  h.push('<section class="fh-sec">' + fhHeading('To do', open ? open + ' left' : ''));
  if (!T.items.length) h.push('<div class="fh-quiet">Nothing urgent</div>');
  T.items.forEach(function (it) {
    h.push('<div class="fh-row fh-li fh-td' + (it.done ? ' done' : '') + '" style="height:' + V.rowH +
      'px;margin-bottom:' + V.gap + 'px;gap:22px">');
    h.push('<div class="fh-dot"></div>');
    h.push('<div class="fh-t" style="font-size:' + V.title + 'px">' + fhEsc(it.title) + '</div>');
    if (it.due) h.push('<div class="fh-due' + (it.late ? ' late' : '') + '">' + fhEsc(it.due) + '</div>');
    h.push('</div>');
  });
  if (T.more) h.push('<div class="fh-quiet">+' + T.more + ' more on the phone</div>');
  h.push('</section>');
}

/* The routines screen's tabs: one per child or baby, with progress; the one shown is black. */
function fhTabs(h, L, p) {
  h.push('<div class="fh-tabs">');
  (p.tabs || []).forEach(function (t, i) {
    h.push('<div class="fh-tab' + (t.on ? ' on' : '') + '">' + fhGlyph(t.icon || 'star', 60, t.on ? 'white' : '') + '<span>' + fhEsc(t.name) +
      (t.sub ? '<small>' + fhEsc(t.sub) + '</small>' : '') + '</span></div>');
  });
  h.push('</div>');
}

/* The baby's plan: one row per step, time · title · icon, like a printed day plan. Read only:
 * no tap targets. Ticked rows are grey with a tick; the next step sits on a black bar;
 * a time that hangs off a step not ticked yet is an estimate and starts with "~"; a step that
 * follows one with no time (waking from a nap) shows what it waits for: "— Milk · after Woke up".
 * A timer step (a nap) reads "Sleep · asleep" while it runs and "Sleep · until 10:40 am · 48 min"
 * once stopped. The wall never counts minutes: it only changes when a phone starts or stops it. */
function fhPlan(h, L, p, above) {
  var P = p.plan;
  if (!P) {
    h.push('<div class="fh-empty"><h2>No plan yet</h2><p>Add one in the Planner.</p></div>');
    return;
  }
  var rows = P.rows || [];
  if (!rows.length) {
    h.push('<div class="fh-quiet">No steps in this plan yet</div>');
    return;
  }
  var V = L.plan;
  var room = L.canvas.h - L.pad.top - L.pad.bottom - 170 - L.gap - (above || 0);
  var rowH = Math.min(V.rowH, Math.floor(room / rows.length));
  var k = rowH / V.rowH;
  var fs = function (n) { return Math.round(n * Math.max(0.8, k)); };
  h.push('<section class="fh-sec fh-plan">');
  rows.forEach(function (r) {
    var cls = r.next ? ' fh-pnext' : r.done ? ' fh-pdone' : r.running ? ' fh-prun' : '';
    var tone = r.next ? 'white' : r.done ? 'muted' : '';
    h.push('<div class="fh-prow' + cls + '" style="height:' + rowH + 'px">' +
      '<span class="fh-ptime" style="font-size:' + fs(V.time) + 'px">' + (r.time ? (r.estimate ? '~' : '') + fhEsc(r.time.replace(/ (am|pm)$/, '')) +
        '<small>' + fhEsc((r.time.match(/(am|pm)$/) || [''])[0]) + '</small>' : '\u2014') + '</span>' +
      '<span class="fh-ptitle" style="font-size:' + fs(V.title) + 'px">' + (r.done ? fhGlyph('check', fs(V.title), 'muted') : '') + '<span>' + fhEsc(r.title) +
        (!r.time && r.waiting ? '<i class="fh-pwait"> \u00b7 ' + fhEsc(r.waiting) + '</i>' : '') +
        (r.note ? (r.running ? ' <b class="fh-prunning">' + fhEsc(r.note) + '</b>' : '<i class="fh-pwait"> \u00b7 ' + fhEsc(r.note) + '</i>') : '') + '</span></span>' +
      '<span class="fh-pg">' + fhGlyph(r.icon || 'star', Math.round(V.glyph * Math.max(0.75, k)), tone) + '</span></div>');
  });
  h.push('</section>');
}

/* The lists screen: each list's open items (and ones ticked in the last couple of minutes,
 * struck through and still tappable, so a mis-tap can be undone). Only the box is a tap target. */
function fhLists(h, L, p) {
  var V = L.lists;
  var lists = p.lists || [];
  if (!lists.length) {
    h.push('<div class="fh-empty"><h2>No lists yet</h2><p>Add one in the Planner.</p></div>');
    return;
  }
  lists.forEach(function (l) {
    h.push('<section class="fh-sec">' + fhHeading(fhEsc(l.name), l.open ? l.open + ' left' : (l.items.length ? fhGlyph('check', 36) + ' All done' : '')));
    if (!l.items.length && !l.more) h.push('<div class="fh-quiet">Nothing on the list</div>');
    l.items.forEach(function (it) {
      h.push('<div class="fh-row fh-li' + (it.done ? ' done' : '') + '" data-slot="' + it.slot + '" style="height:' + V.rowH +
        'px;margin-bottom:' + V.gap + 'px;gap:28px">');
      h.push('<div class="fh-check" data-hit="1" data-on-tap="@slot' + it.slot + '" data-touch-id="' + fhEsc(it.touch_id) +
        '" style="width:' + V.box + 'px;height:' + V.box + 'px;border-width:7px">' + (it.done ? fhGlyph('check', V.box - 30, 'white') : '') + '</div>');
      h.push('<div class="fh-t" style="font-size:' + V.title + 'px">' + fhEsc(it.title) + '</div>');
      // Dated items: when it is due, right-aligned; overdue ones on black.
      if (it.due) h.push('<div class="fh-due' + (it.late ? ' late' : '') + '">' + fhEsc(it.due) + '</div>');
      h.push('</div>');
    });
    if (l.more) h.push('<div class="fh-quiet">+' + l.more + ' more on the phone</div>');
    h.push('</section>');
  });
}

/* The routines screen: heading, a tab per child or baby, then the chosen one's checklist, a
 * baby's day plan, or (no routine on) when the next one starts. */
function fhRoutines(h, L, p, child, mode) {
  h.push('<header class="fh-head"><div><div class="fh-date">Routines</div><div class="fh-day"><span>' + fhEsc(p.date_label) + '</span></div></div>' + fhPages(p) + '</header>');
  if (!(p.tabs || []).length) {
    h.push('<div class="fh-empty"><h2>No one to show</h2><p>Add a child in the Planner.</p></div>');
    return;
  }
  fhTabs(h, L, p);
  if (p.plan) {
    fhPlan(h, L, p, 120 + L.gap);
    return;
  }
  var r = child && child.routine;
  if (r && p.view !== 'week') {
    var n = (p.slots || []).length;
    var Vr = L.variants[mode];
    var room = L.canvas.h - L.pad.top - L.pad.bottom - 190 - (120 + L.gap) - L.gap - 72;
    var k = n ? Math.min(1, room / (n * (Vr.rowH + Vr.gap))) : 1;
    fhChecklist(h, { rowH: Math.floor(Vr.rowH * k), gap: Math.floor(Vr.gap * k), glyph: Math.floor(Vr.glyph * k), title: Vr.title }, p, child, r, mode);
    return;
  }
  var title = r && r.all_done ? fhEsc(r.name) + ' done' : 'No routine on now';
  var next = child && child.next ? 'Next: ' + fhEsc(child.next.name) + ' at ' + fhEsc(child.next.start) : '';
  h.push('<div class="fh-rest">' + (r && r.all_done ? fhGlyph('star', 120) : '') + '<h2>' + title + '</h2>' + (next ? '<p>' + next + '</p>' : '') + '</div>');
}

/** data: { hub, week?, today? } — the Tesserae code element's ctx.data (week/today absent in /sim). */
function paintWall(root, data, opts) {
  opts = opts || {};
  var L = LAYOUT;
  var css =
    '*{box-sizing:border-box;margin:0;padding:0}' +
    '.fh{position:relative;width:' + L.canvas.w + 'px;height:' + L.canvas.h + 'px;background:#fff;color:#000;' + fhSans(500) +
    'overflow:hidden;display:flex;flex-direction:column;padding:' + L.pad.top + 'px ' + L.pad.x + 'px ' + L.pad.bottom + 'px}' +
    '.fh-head{display:flex;align-items:flex-start;gap:24px}' +
    '.fh-head>div:first-child{flex:1;min-width:0}' +
    '.fh-nav{flex:none;display:flex;align-items:center;gap:14px;height:96px;padding:0 36px 0 26px;border:5px solid #000;' +
    'border-radius:48px;font-size:44px;' + fhSans(700) + 'background:#fff}' +
    '.fh-date{font-size:80px;line-height:1.05;letter-spacing:-1px;' + fhSerif(650) + '}' +
    '.fh-day{display:flex;align-items:center;gap:14px;font-size:40px;color:#333;margin-top:8px}' +
    '.fh-sec{margin-top:' + L.gap + 'px}' +
    '.fh-grow{flex:1;min-height:0;display:flex;flex-direction:column}' +
    '.fh-fit{overflow:hidden}' +
    '.fh-bottom{margin-top:auto;padding-top:' + L.gap + 'px}' +
    '.fh-h{display:flex;align-items:baseline;justify-content:space-between;gap:24px;font-size:52px;line-height:1;' +
    'padding-bottom:6px;margin-bottom:14px;' + fhSerif(650) + '}' +
    '.fh-meta{font-size:34px;white-space:nowrap;display:flex;align-items:center;gap:10px;align-self:center;' + fhSans(600) + '}' +
    '.fh-dots{display:flex;gap:12px}' +
    '.fh-dots b{width:36px;height:36px;border-radius:50%;border:5px solid #000;display:block}' +
    '.fh-dots b.on{background:#000}' +
    '.fh-ev{display:flex;align-items:center;font-size:46px;line-height:1.2;padding:6px 0}' +
    '.fh-when{flex:none;width:220px;' + fhSans(700) + '}' +
    '.fh-what{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.fh-what i{font-style:normal;color:#888}' +
    '.fh-allday .fh-when,.fh-more .fh-what{color:#555;' + fhSans(500) + '}' +
    '.fh-past{color:#999}' +
    '.fh-now .fh-when{text-decoration:underline;text-decoration-thickness:5px;text-underline-offset:8px}' +
    '.fh-mine{display:inline-block;vertical-align:-4px;margin-right:12px}' +
    '.fh-row{display:flex;align-items:center;border-radius:36px;background:#eeeeee;padding:0 32px 0 20px}' +
    '.fh-check{flex:none;border:9px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff}' +
    '.fh-row.done .fh-check{background:#000}' +
    '.fh-g{flex:none;display:flex;align-items:center;justify-content:center}' +
    '.fh-t{flex:1;min-width:0;line-height:1.05;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + fhSans(600) + '}' +
    '.fh-row.done .fh-t{color:#999;text-decoration:line-through;text-decoration-thickness:6px;' + fhSans(500) + '}' +
    '.fh-wk-row{display:flex;align-items:center;gap:28px;padding:14px 0;border-bottom:2px solid #cccccc}' +
    '.fh-wk-day{flex:none;width:190px;display:flex;flex-direction:column}' +
    '.fh-wk-day b{font-size:46px;line-height:1;' + fhSerif(650) + '}' +
    '.fh-wk-day span{font-size:30px;color:#555;margin-top:6px}' +
    '.fh-wk-evs{flex:1;min-width:0}' +
    '.fh-wk-ev{font-size:42px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.fh-wk-ev b{' + fhSans(700) + '}' +
    '.fh-loc{color:#777}' +
    '.fh-wk-ev i{font-style:normal;color:#666}' +
    '.fh-quiet{font-size:40px;color:#666;padding:20px 0}' +
    '.fh-due{flex:none;font-size:38px;' + fhSans(600) + 'color:#444;padding:6px 18px;border-radius:999px;background:#fff}' +
    '.fh-due.late{background:#000;color:#fff}' +
    '.fh-empty{margin-top:200px;text-align:center}' +
    '.fh-empty h2{font-size:80px;' + fhSerif(650) + '}' +
    '.fh-empty p{font-size:52px;margin-top:28px}' +
    '.fh-foot{position:absolute;left:' + L.pad.x + 'px;right:' + L.pad.x + 'px;bottom:28px;display:flex;justify-content:space-between;font-size:26px;color:#777}' +
    '.fh-warn{color:#000;' + fhSans(700) + '}' +
    '.fh-navs{flex:none;display:flex;gap:18px}' +
    '.fh-pages{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin-top:8px}' +
    '.fh-pages>div{display:flex;gap:10px}' +
    '.fh-page{display:flex;align-items:center;height:60px;padding:0 22px;border:4px solid #000;border-radius:30px;font-size:30px;' + fhSans(700) + '}' +
    '.fh-page.on{background:#000;color:#fff}' +
    '.fh-pages small{font-size:28px;color:#333;' + fhSans(500) + '}' +
    '.fh-sub{font-size:44px;color:#555;margin-left:18px;' + fhSans(500) + '}' +
    '.fh-plan{border-top:5px solid #000}' +
    '.fh-prow{display:flex;align-items:center;gap:28px;padding:0 24px;border-bottom:2px solid #cccccc}' +
    '.fh-ptime{flex:none;width:300px;white-space:nowrap;' + fhSans(400) + '}' +
    '.fh-ptime small{font-size:0.55em;margin-left:8px;color:#555}' +
    '.fh-ptitle{flex:1;min-width:0;display:flex;align-items:center;gap:16px;white-space:nowrap;overflow:hidden;' + fhSans(600) + '}' +
    '.fh-ptitle span{overflow:hidden;text-overflow:ellipsis}' +
    '.fh-pg{flex:none;display:flex;align-items:center}' +
    '.fh-pwait{font-style:normal;color:#666;' + fhSans(500) + '}' +
    '.fh-pnext .fh-pwait{color:#ddd}' +
    '.fh-pdone{color:#999}' +
    '.fh-prun{background:#eeeeee;border-radius:24px}' +
    '.fh-prunning{display:inline-block;margin-left:16px;padding:2px 18px;border:4px solid #000;border-radius:999px;font-size:0.8em;' + fhSans(700) + '}' +
    '.fh-nav2{height:96px;gap:12px}' +
    '.fh-nav span{display:flex;flex-direction:column;line-height:1}' +
    '.fh-nav small{font-size:28px;margin-top:6px;' + fhSans(500) + '}' +
    '.fh-pdone .fh-ptime small{color:#999}' +
    '.fh-pnext{background:#000;color:#fff;border-radius:24px;border-bottom-color:#000}' +
    '.fh-pnext .fh-ptime small{color:#fff}' +
    '.fh-top{flex:none;max-height:' + L.home.topH + 'px;display:flex;flex-direction:column;overflow:hidden}' +
    '.fh-top .fh-cols{flex:none}.fh-top .fh-col:first-child{flex:1.2 1 0}' +
        '.fh-wx{flex:none;display:grid;grid-template-columns:repeat(4,1fr);margin-top:28px;padding:24px 0 26px;border-radius:36px;background:#eeeeee}' +
    '.fh-wx-b{min-width:0;display:flex;flex-direction:column;gap:8px;padding:0 24px;border-left:3px solid #cccccc}' +
    '.fh-wx-b:first-child{border-left:0}' +
    '.fh-wx-when{display:flex;align-items:baseline;gap:12px;white-space:nowrap}' +
    '.fh-wx-when b{font-size:36px;' + fhSans(700) + '}.fh-wx-when small{font-size:28px;color:#444;' + fhSans(500) + '}' +
    '.fh-wx-sky{display:flex;align-items:center;gap:12px;height:104px}' +
    '.fh-wx-sky svg{flex:none}' +
    '.fh-wx-sky b{font-size:100px;line-height:1;letter-spacing:-3px;' + fhSerif(650) + '}' +
    '.fh-wx-word{font-size:32px;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + fhSans(600) + '}' +
    '.fh-wx-chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}' +
    '.fh-chip{display:inline-flex;align-items:center;gap:10px;height:56px;padding:0 16px 0 12px;box-sizing:border-box;border:4px solid #000;border-radius:28px;background:#fff;color:#000;font-size:30px;white-space:nowrap;' + fhSans(700) + '}' +
    '.fh-chip b{padding-left:6px;' + fhSans(700) + '}' +
    '.fh-chip i{display:block;width:4px;height:32px;border-radius:2px;background:currentColor}' +
    '.fh-chip.hot{background:#000;color:#fff}' +
    '.fh-chip.quiet{border-color:#999999;color:#777777}' +
'.fh-arrow{display:inline-flex;flex:none}' +
    '.fh-wk-due{display:flex;align-items:center;gap:10px}' +
    '.fh-agenda .fh-wk-ev{line-height:1.3}' +
    '.fh-cols{display:flex;gap:' + L.home.colGap + 'px;align-items:flex-start}' +
    '.fh-col{flex:1 1 0;min-width:0}' +
    '.fh-col .fh-ev{font-size:40px;padding:5px 0}' +
    '.fh-col .fh-when{width:180px}' +
    '.fh-td{padding:0 4px;border-radius:0;background:none;border-bottom:3px solid #ddd}' +
    '.fh-td .fh-due{font-size:32px;padding:4px 14px;background:#eee}.fh-td .fh-due.late{background:#000;color:#fff}' +
    '.fh-dot{flex:none;width:18px;height:18px;border-radius:50%;background:#000}' +
    '.fh-td.done .fh-dot{background:#999}' +
    '.fh-tabs{display:flex;gap:20px;margin-top:' + L.gap + 'px}' +
    '.fh-tab{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:18px;height:120px;padding:0 28px;border:5px solid #000;border-radius:60px;font-size:50px;' + fhSans(700) + '}' +
    '.fh-tab span{display:flex;flex-direction:column;line-height:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.fh-tab small{font-size:30px;margin-top:8px;' + fhSans(500) + '}' +
    '.fh-tab.on{background:#000;color:#fff}' +
    '.fh[data-screen=routines] .fh-bottom{margin-top:0}' +
    '.fh-rest{margin-top:160px;text-align:center}' +
    '.fh-rest h2{font-size:72px;' + fhSerif(650) + '}' +
    '.fh-rest p{font-size:48px;margin-top:24px;color:#333}';

  var hub = (data && data.hub) || {};
  if (hub.error && !hub.payload) {
    root.innerHTML = '<style>' + css + '</style><div class="fh"><div class="fh-empty"><h2>Family Hub offline</h2><p>' +
      fhEsc(hub.error).slice(0, 120) + '</p></div></div>';
    return;
  }
  var p = hub.payload || {};
  var child = (p.children || [])[0];
  var mode = p.mode === 'picture' ? 'picture' : 'reader';
  var h = [];
  h.push('<style>' + css + '</style><div class="fh" data-mode="' + mode + '" data-screen="' + (p.screen === 'lists' || p.screen === 'plan' || p.screen === 'routines' ? p.screen : 'home') + '">');

  // Quiet footer. The device name keeps each device's frame unique (Tesserae keys tap maps by pixel hash).
  var footLeft = hub.stale ? '<span class="fh-warn">Hub offline · last updated ' + fhEsc(p.updated_label) + '</span>'
    : 'Updated ' + fhEsc(p.updated_label) + (p.device_label ? ' · ' + fhEsc(p.device_label) : '');

  if (p.screen === 'lists') {
    h.push('<header class="fh-head"><div><div class="fh-date">Lists</div><div class="fh-day"><span>' + fhEsc(p.date_label) + '</span></div></div>' + fhPages(p) + '</header>');
    fhLists(h, L, p);
    h.push('<div class="fh-foot"><span>' + footLeft + '</span><span></span></div></div>');
    root.innerHTML = h.join('');
    return;
  }

  if (p.screen === 'plan') {
    var pn = p.plan;
    h.push('<header class="fh-head"><div><div class="fh-date">' + (pn ? fhEsc(pn.name) + '<span class="fh-sub">' + fhEsc(pn.plan) + '</span>' : 'Day plan') +
      '</div><div class="fh-day"><span>' + fhEsc(p.date_label) + '</span></div></div>' + fhPages(p) + '</header>');
    fhPlan(h, L, p);
    h.push('<div class="fh-foot"><span>' + footLeft + '</span><span>Tick on the phone</span></div></div>');
    root.innerHTML = h.join('');
    return;
  }

  if (p.screen === 'routines') {
    fhRoutines(h, L, p, child, mode);
    var more = p.overflow ? '+' + p.overflow + ' more steps in the Planner' : (p.plan ? 'Tick on the phone' : '');
    h.push('<div class="fh-foot"><span>' + footLeft + '</span><span>' + more + '</span></div></div>');
    root.innerHTML = h.join('');
    return;
  }

  // One date; the day type underneath ("Daycare day") when there is one.
  h.push('<div class="fh-top"><header class="fh-head"><div><div class="fh-date">' + fhEsc(p.date_label) + '</div>');
  if (child && child.today.day_type) {
    h.push('<div class="fh-day">' + (child.today.glyph ? fhGlyph(child.today.glyph, 48) : '') + '<span>' + fhEsc(child.today.day_type) + ' day</span></div>');
  }
  h.push('</div>' + fhPages(p) + '</header>');
  fhWeather(h, p);

  // TODAY beside TO DO, filling the rest of the top half; TODAY shows as many lines as fit.
  var V = L.home;
  var todayRows = Math.max(4, Math.floor((V.todoSlots * (V.rowH + V.gap) + (p.weather ? 0 : 190)) / 58));
  h.push('<div class="fh-cols"><div class="fh-col">');
  if (data && data.today) fhToday(h, p, child, data.today, todayRows, true);
  else if (opts.calendarPlaceholder) h.push('<section class="fh-sec">' + fhHeading('Today') + '<div class="fh-quiet">Calendar shows here on the wall</div></section>');
  h.push('</div><div class="fh-col">');
  fhTodo(h, L, p);
  h.push('</div></div></div>');
  fhComingUp(h, p, null, null, data && data.week, false, true);

  h.push('<div class="fh-foot"><span>' + footLeft + '</span><span>Any side button refreshes</span></div>');
  h.push('</div>');
  root.innerHTML = h.join('');
  fhFitDate(root);
  fhGrowDay(root, L);
  fhFit(root);
}

/** Option A (owner 2026-11-11): the day takes the room it needs. TODAY and TO DO grow (CSS zoom,
 * up to ×1.3) while the top half stays within `home.topH`; the agenda below takes the rest, so
 * there is no gap on a quiet day. The date and the weather band never scale. */
function fhGrowDay(root, L) {
  var top = root.querySelector('.fh-top');
  var cols = top && top.querySelector('.fh-cols');
  if (!cols || !top.offsetHeight) return; // no layout (tests)
  var k = 1;
  while (k < 1.3) {
    cols.style.zoom = (k + 0.05).toFixed(2);
    if (top.scrollHeight > L.home.topH) break;
    k += 0.05;
  }
  cols.style.zoom = k.toFixed(2);
}

/** Keep the date on one line: with two buttons beside it a long date ("Wednesday 30 September")
 * would wrap and push the page down, so step its size down until it fits (80 px → at least 56). */
function fhFitDate(root) {
  var d = root.querySelector('.fh-date');
  if (!d || !d.offsetHeight) return; // offsetHeight: layout pixels, unaffected by the sim's scaling
  var size = 80;
  while (size > 56 && d.offsetHeight > size * 1.3) {
    size -= 4;
    d.style.fontSize = size + 'px';
  }
}

/** Drop the COMING UP days that don't fit (whole days, never half a row). The strip above
 * the checklist goes entirely when no day fits; the full view keeps its heading. */
function fhFit(root) {
  var sec = root.querySelector('.fh-fit');
  if (!sec || !sec.getBoundingClientRect) return;
  var bottom = sec.getBoundingClientRect().bottom;
  var rows = sec.querySelectorAll('.fh-wk-row');
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].getBoundingClientRect().bottom > bottom + 1) rows[i].remove();
  if (sec.classList.contains('fh-fill') && !sec.querySelector('.fh-wk-row')) sec.remove();
}
