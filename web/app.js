/* Meteor Chaser UI. Depends on model.js (window.MC). */
{
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const store = { get(k, d) { try { const v = localStorage.getItem('mc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mc.' + k, JSON.stringify(v)); } catch {} } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt1 = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const toast = (t) => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 1800); };

const S = {
  origin: store.get('origin', { lat: 34.07, lon: -118.44, name: 'Westwood, Los Angeles', tz: 'America/Los_Angeles' }),
  date: todayISO(), maxMin: store.get('maxMin', 120), watch: store.get('watch', 3), vot: store.get('vot', 4), cloud: 15,
  count: 'total', k: store.get('k', 1), live: false, cands: [], nights: [], night: 0, sel: null, skyRaster: null,
};
let CITIES, TZ, IDX, LAND, NAMED;

// ---------- time zones ----------
function tzOffsetMin(tz, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute) - d.getTime()) / 60000;
}
function localToUTC(iso, hour, tz) { const [y, m, d] = iso.split('-').map(Number); const t = Date.UTC(y, m - 1, d, hour); return new Date(t - tzOffsetMin(tz, new Date(t)) * 60000); }
const round5 = (d) => new Date(Math.round(d.getTime() / 300000) * 300000);
const tfmt = (d, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(round5(d));
const hfmt = (d, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(d);
const dfmt = (d, tz, o = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(d);
function nearestNamed(lat, lon, maxKm = 1e9) {
  let b = null, bd = maxKm;
  for (const c of NAMED) { if (Math.abs(c[0] - lat) > 6) continue; const d = MC.hav(lat, lon, c[0], c[1]); if (d < bd) { bd = d; b = c; } }
  return b ? { name: b[3], tz: TZ[b[4]], km: bd, lat: b[0], lon: b[1] } : null;
}
function bearingWord(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * Math.PI / 180) * Math.cos(la2 * Math.PI / 180);
  const x = Math.cos(la1 * Math.PI / 180) * Math.sin(la2 * Math.PI / 180) - Math.sin(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.cos((lo2 - lo1) * Math.PI / 180);
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) / 45) % 8];
}
const azWord = (az) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(az / 45) % 8];
function placeName(c) {
  const n = nearestNamed(c.lat, c.lon, 400); if (!n) return `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°`;
  if (n.km < 3) return 'In ' + n.name.split(',')[0];
  return `${Math.round(n.km)} km ${bearingWord(n.lat, n.lon, c.lat, c.lon)} of ${n.name.split(',')[0]}`;
}

// ---------- network ----------
async function fetchT(url, ms = 12000, opt = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { ...opt, signal: ac.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}
async function probeLive() { try { await fetchT('https://api.open-meteo.com/v1/elevation?latitude=0&longitude=0', 5000); return true; } catch { return false; } }
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function enrichLive(cands, msg) {
  const o = S.origin;
  // 1. roads: OSRM table snaps each site to the nearest road and gives drive time from the origin
  msg('Routing every site by road…');
  let routed = 0;
  for (const part of chunk(cands.slice(1), 90)) {
    try {
      const coords = [[o.lon, o.lat], ...part.map((c) => [c.lon, c.lat])].map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');
      const r = await fetchT(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration`, 20000);
      part.forEach((c, i) => {
        const dur = r.durations?.[0]?.[i + 1], dst = r.destinations?.[i + 1];
        if (dur == null || !dst || dst.distance > 6000) { c.drop = true; return; }
        c.lon = dst.location[0]; c.lat = dst.location[1]; c.drive = dur / 60 * 1.05; c.routed = true; routed++;
      });
    } catch { /* keep estimates */ }
  }
  cands[0].drive = 0;
  for (const c of cands) if (!c.drive && c !== cands[0]) c.drive = MC.estDriveMin(c.km);
  const kept = cands.filter((c) => !c.drop);
  // de-duplicate sites that snapped to the same road point
  const seen = new Set(), uniq = kept.filter((c) => { const k = c.lat.toFixed(2) + ',' + c.lon.toFixed(2); if (seen.has(k)) return false; seen.add(k); return true; });
  for (const c of uniq) c.sky = MC.skyBrightness(IDX, c.lat, c.lon);
  // 2. elevation
  msg('Reading terrain…');
  for (const part of chunk(uniq, 100)) {
    try { const r = await fetchT(`https://api.open-meteo.com/v1/elevation?latitude=${part.map((c) => c.lat.toFixed(4)).join(',')}&longitude=${part.map((c) => c.lon.toFixed(4)).join(',')}`); part.forEach((c, i) => (c.elev = r.elevation[i])); } catch {}
  }
  // 3. weather, 8 nights
  msg('Pulling hourly cloud, cold and wind for every site…');
  const start = S.date, endD = new Date(Date.parse(S.date) + 8 * 864e5).toISOString().slice(0, 10);
  let wx = 0;
  for (const part of chunk(uniq, 50)) {
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${part.map((c) => c.lat.toFixed(3)).join(',')}&longitude=${part.map((c) => c.lon.toFixed(3)).join(',')}` +
        `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,apparent_temperature,wind_speed_10m,precipitation_probability&timeformat=unixtime&timezone=GMT&start_date=${start}&end_date=${endD}`;
      let r = await fetchT(u, 25000); if (!Array.isArray(r)) r = [r];
      part.forEach((c, i) => { c.wx = r[i]?.hourly; if (c.wx) wx++; });
    } catch {}
  }
  return { sites: uniq, routed, wx };
}
function weatherFn(c) {
  if (!S.live || !c.wx) return () => ({ total: S.cloud });
  const h = c.wx, t0 = h.time[0];
  return (J) => {
    const i = Math.floor(((J - 2440587.5) * 86400 - t0) / 3600); if (i < 0 || i >= h.time.length) return null;
    const v = (k) => h[k]?.[i];
    if (v('cloud_cover_low') == null && v('cloud_cover') == null) return null;
    return { low: v('cloud_cover_low') ?? 0, mid: v('cloud_cover_mid') ?? 0, high: v('cloud_cover_high') ?? 0, total: v('cloud_cover'), temp: v('temperature_2m'), feels: v('apparent_temperature'), wind: v('wind_speed_10m'), pop: v('precipitation_probability') };
  };
}

// ---------- pipeline ----------
async function run() {
  const o = S.origin, msg = (t) => ($('#msg').textContent = t);
  store.set('origin', o); store.set('maxMin', S.maxMin); store.set('watch', S.watch); store.set('vot', S.vot);
  const maxKm = Math.max(15, (S.maxMin - 8) / 60 * 80 / 1.32);
  let cands = MC.candidates(o, maxKm, LAND, 7, 18);
  for (const c of cands) { c.sky = MC.skyBrightness(IDX, c.lat, c.lon); c.elev = 0; c.drive = c === cands[0] ? 0 : MC.estDriveMin(c.km); }
  S.skyRaster = null; S.extentKm = maxKm * 1.12;
  if (S.live) {
    try { const r = await enrichLive(cands, msg); cands = r.sites; msg(`${cands.length} sites on real roads · forecast for ${r.wx} · ${r.routed ? 'drive times by OSRM' : 'drive times estimated'}`); }
    catch (e) { msg('Live data failed, using clear-sky estimates.'); }
  } else msg(`${cands.length} sites · drive times estimated from distance`);
  cands = cands.filter((c) => c.drive <= S.maxMin * 1.08 || c === cands[0]);
  S.cands = cands;
  evaluate(true);
}
function evaluate(recompute) {
  const o = S.origin, tz = o.tz, nN = S.live ? 7 : 7;
  if (recompute) {
    S.nights = [];
    for (let n = 0; n < nN; n++) {
      const iso = new Date(Date.parse(S.date) + n * 864e5).toISOString().slice(0, 10), start = localToUTC(iso, 17, tz);
      for (const c of S.cands) { c.prof = c.prof || []; c.prof[n] = MC.nightProfile(c, start, 15, c.sky, MC.SHOWERS, weatherFn(c), 1); }
      S.nights.push({ iso, start });
    }
  }
  for (let n = 0; n < S.nights.length; n++) {
    const res = S.cands.map((c) => {
      const w = MC.bestWindow(c.prof[n], S.watch); if (!w) return null;
      const meteors = (S.count === 'bright' ? w.bright : w.total) * S.k, trip = 2 * c.drive / 60 + S.watch;
      return { c, w, meteors, drive: c.drive, util: meteors - S.vot * (2 * c.drive / 60) };
    }).filter(Boolean);
    const front = MC.pareto(res, [{ key: 'meteors', dir: 1 }, { key: 'drive', dir: -1 }]).sort((a, b) => a.drive - b.drive);
    const pick = res.reduce((b, r) => (!b || r.util > b.util ? r : b), null);
    const mid = new Date(S.nights[n].start.getTime() + 9 * 36e5), mo = MC.moon(MC.jd(mid));
    Object.assign(S.nights[n], { res, front, pick, knee: MC.knee(front, 'drive', 'meteors'), moon: mo.illum });
  }
  S.sel = null; render();
}

// ---------- rendering ----------
function render() {
  renderNights(); const N = S.nights[S.night]; if (!N) return;
  const r = S.sel ? N.res.find((x) => x.c === S.sel) || N.pick : N.pick;
  renderPick(r, N); drawMap(); drawPareto(); renderHours(r, N); renderCompass(r); $('#parking').innerHTML = '';
}
function renderNights() {
  $('#nights').innerHTML = S.nights.map((N, i) => `<button type="button" class="night" data-n="${i}" aria-pressed="${i === S.night}">
    <div class="d">${esc(dfmt(N.start, S.origin.tz))}</div><div class="n">${N.pick ? fmt1(N.pick.meteors) : '–'}</div>
    <div class="s">${N.pick ? Math.round(N.pick.drive) + ' min away' : ''}</div><div class="moonbar" title="Moon ${Math.round(N.moon * 100)}%"><i style="width:${Math.round(N.moon * 100)}%"></i></div></button>`).join('');
}
function topShower(r) {
  const tot = {}; for (const p of r.c.prof[S.night].slice(r.w.i, r.w.j)) for (const [k, v] of Object.entries(p.by)) tot[k] = (tot[k] || 0) + v.n;
  const best = Object.entries(tot).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0.3 ? MC.SHOWERS.find((s) => s.id === best[0]) : null;
}
function renderPick(r, N) {
  const tz = S.origin.tz, c = r.c, w = r.w, leave = new Date(w.start - c.drive * 6e4), home = new Date(w.end.getTime() + c.drive * 6e4);
  const sh = topShower(r), isPick = r === N.pick, isFront = N.front.includes(r);
  const feels = isFinite(w.minFeels) ? Math.round(w.minFeels) + '°C' : '–';
  r.name = placeName(c);
  $('#pick').innerHTML = `
    <div class="mute" style="font-size:14px">${isPick ? 'Best trade-off for ' + esc(dfmt(N.start, tz)) : isFront ? 'On the frontier' : 'Selected site'}</div>
    <div class="pickname">${esc(r.name)}</div>
    <div class="mono dim">${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}${c.elev ? ' · ' + Math.round(c.elev) + ' m' : ''}</div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:12px"><span class="big">${fmt1(r.meteors)}</span><span class="mute">${S.count === 'bright' ? 'bright meteors' : 'meteors'} in ${S.watch} h${sh ? ', mostly ' + esc(sh.name) : ''}</span></div>
    <div class="tiles">
      <div class="tile"><b>${Math.round(c.drive)} min</b><span>${c.routed ? 'drive, by road' : 'drive, estimated'}</span></div>
      <div class="tile"><b>Bortle ${c.sky.bortle}</b><span>SQM ${c.sky.sqm.toFixed(2)}</span></div>
      <div class="tile"><b>${Math.round((1 - w.meanT) * 100)}%</b><span>sky lost to cloud</span></div>
      ${isFinite(w.minFeels) ? `<div class="tile"><b>${feels}</b><span>coldest feels-like</span></div><div class="tile"><b>${Math.round(w.maxWind || 0)} km/h</b><span>peak wind</span></div>`
        : `<div class="tile"><b>${Math.round(N.moon * 100)}%</b><span>moon lit</span></div><div class="tile"><b>${c.sky.nearTownKm < 999 ? Math.round(c.sky.nearTownKm) + ' km' : '–'}</b><span>to nearest town</span></div>`}
      <div class="tile"><b>${fmt1((S.count === 'bright' ? w.total : w.bright) * S.k)}</b><span>${S.count === 'bright' ? 'all meteors' : 'bright ones'}</span></div>
    </div>
    <ol class="sched">
      <li><time>${tfmt(leave, tz)}</time><span>Leave ${esc(S.origin.name.split(',')[0])}</span></li>
      <li><time>${tfmt(w.start, tz)}</time><span>Lights off, start watching</span></li>
      <li><time>${tfmt(w.end, tz)}</time><span>Stop. ${w.end.getTime() - w.start.getTime() > 0 ? 'Best hour is the last one if the radiant is still climbing.' : ''}</span></li>
      <li><time>${tfmt(home, tz)}</time><span>Home</span></li>
    </ol>
    <div class="actions"><a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat.toFixed(5)},${c.lon.toFixed(5)}" target="_blank" rel="noopener">Directions</a><button type="button" id="copyPlan">Copy plan</button></div>`;
  $('#copyPlan').onclick = () => copyPlan(r, N);
  S.cur = r;
}
function copyPlan(r, N) {
  const tz = S.origin.tz, c = r.c, w = r.w, sh = topShower(r);
  const t = `${sh ? sh.name.toUpperCase() + ' ' : 'METEORS '}— ${dfmt(N.start, tz)}\n${r.name}\n${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}\nhttps://www.google.com/maps/dir/?api=1&destination=${c.lat.toFixed(5)},${c.lon.toFixed(5)}\n\n` +
    `Leave ${tfmt(new Date(w.start - c.drive * 6e4), tz)} · ${Math.round(c.drive)} min drive\nWatch ${tfmt(w.start, tz)}–${tfmt(w.end, tz)}\nHome ${tfmt(new Date(w.end.getTime() + c.drive * 6e4), tz)}\n\n` +
    `Expect ~${fmt1(r.meteors)} meteors (±40%). Bortle ${c.sky.bortle}. ${Math.round((1 - w.meanT) * 100)}% cloud.${isFinite(w.minFeels) ? ' Feels like ' + Math.round(w.minFeels) + '°C.' : ''}\nFace ${S.faceWord || 'east'}, look halfway up.`;
  navigator.clipboard?.writeText(t).then(() => toast('Plan copied'), () => toast('Copy blocked here'));
}

// ---------- map ----------
const ramp = [[22, [6, 8, 26]], [21.6, [16, 20, 52]], [21.2, [34, 34, 92]], [20.7, [70, 40, 120]], [20.2, [120, 48, 128]], [19.6, [170, 64, 120]], [19, [214, 96, 95]], [18.4, [250, 180, 122]], [17.5, [255, 241, 200]]];
function sqmColor(s) {
  if (s >= ramp[0][0]) return ramp[0][1]; for (let i = 1; i < ramp.length; i++) if (s >= ramp[i][0]) { const [a, ca] = ramp[i - 1], [b, cb] = ramp[i], f = (a - s) / (a - b); return ca.map((v, k) => Math.round(v + (cb[k] - v) * f)); }
  return ramp[ramp.length - 1][1];
}
function buildRaster() {
  const o = S.origin, E = S.extentKm * 1.7, n = 104, img = new ImageData(n, n), kx = 111.32 * Math.cos(o.lat * Math.PI / 180), ky = 110.57;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * 2 * E - E, y = E - (j + 0.5) / n * 2 * E, lat = o.lat + y / ky, lon = o.lon + x / kx, p = (j * n + i) * 4;
    const col = LAND(lat, lon) ? sqmColor(MC.skyBrightness(IDX, lat, lon).sqm) : [3, 7, 18];
    img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2]; img.data[p + 3] = 255;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = n; cv.getContext('2d').putImageData(img, 0, 0); S.skyRaster = cv;
}
function drawMap() {
  const cv = $('#mapc'), box = cv.parentElement, W = box.clientWidth, H = box.clientHeight, dpr = devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!S.skyRaster) buildRaster();
  const o = S.origin, E = S.extentKm, RE = E * 1.7, s = Math.min(W, H) / (2 * E), kx = 111.32 * Math.cos(o.lat * Math.PI / 180), ky = 110.57;
  const P = (lat, lon) => [W / 2 + (lon - o.lon) * kx * s, H / 2 - (lat - o.lat) * ky * s];
  g.imageSmoothingEnabled = true; g.fillStyle = '#03070f'; g.fillRect(0, 0, W, H); g.drawImage(S.skyRaster, W / 2 - RE * s, H / 2 - RE * s, 2 * RE * s, 2 * RE * s);
  // drive-time rings
  g.setLineDash([3, 5]); g.strokeStyle = 'rgba(233,237,248,.22)'; g.fillStyle = 'rgba(233,237,248,.55)'; g.font = '12px "IBM Plex Sans",sans-serif';
  for (const m of [30, 60, 90, 120, 180, 240].filter((m) => m <= S.maxMin)) { const km = (m - 8) / 60 * 80 / 1.32; g.beginPath(); g.arc(W / 2, H / 2, km * s, 0, 7); g.stroke(); g.fillText(m + ' min', W / 2 + 4, H / 2 - km * s - 4); }
  g.setLineDash([]);
  // big cities
  g.fillStyle = 'rgba(233,237,248,.7)';
  for (const c of NAMED) { if (c[2] < 400) break; const [x, y] = P(c[0], c[1]); if (x > 8 && x < W - 60 && y > 14 && y < H - 6) { g.fillText(c[3].split(',')[0], x + 4, y - 4); } }
  const N = S.nights[S.night]; if (!N) return;
  const mx = Math.max(...N.res.map((r) => r.meteors), 1); S.mapPts = [];
  for (const r of N.res) { const [x, y] = P(r.c.lat, r.c.lon), rad = 2 + 7 * Math.sqrt(r.meteors / mx); S.mapPts.push([x, y, r]); g.beginPath(); g.arc(x, y, rad, 0, 7); g.fillStyle = `rgba(233,237,248,${0.25 + 0.6 * r.meteors / mx})`; g.fill(); }
  g.lineWidth = 2; g.strokeStyle = '#7fdcff';
  for (const r of N.front) { const [x, y] = P(r.c.lat, r.c.lon); g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
  const cur = S.cur || N.pick; if (cur) { const [x, y] = P(cur.c.lat, cur.c.lon); star(g, x, y, 13, '#ffc9a3'); }
  const [ox, oy] = P(o.lat, o.lon); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ox - 8, oy); g.lineTo(ox + 8, oy); g.moveTo(ox, oy - 8); g.lineTo(ox, oy + 8); g.stroke();
}
function star(g, x, y, R, col) {
  g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.45 : R; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
  g.closePath(); g.fillStyle = col; g.fill(); g.strokeStyle = '#060914'; g.lineWidth = 1.5; g.stroke();
}
$('#mapc').addEventListener('click', (e) => {
  const b = e.target.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  let best = null, bd = 18; for (const [px, py, r] of S.mapPts || []) { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = r; } }
  if (best) select(best);
});
function select(r) { S.sel = r.c; const N = S.nights[S.night]; renderPick(r, N); drawMap(); drawPareto(); renderHours(r, N); renderCompass(r); $('#parking').innerHTML = ''; }

// ---------- Pareto chart ----------
function drawPareto() {
  const svg = $('#paretoSvg'), W = svg.clientWidth, H = svg.clientHeight, N = S.nights[S.night]; if (!N || !W) return;
  const m = { l: 44, r: 14, t: 14, b: 36 }, xs = N.res.map((r) => r.drive), ys = N.res.map((r) => r.meteors);
  const X = (v) => m.l + v / (Math.max(...xs, 1)) * (W - m.l - m.r), Y = (v) => H - m.b - v / (Math.max(...ys, 1) * 1.08) * (H - m.t - m.b);
  const ty = niceTicks(Math.max(...ys, 1) * 1.08, W < 520 ? 3 : 5), tx = niceTicks(Math.max(...xs, 1), W < 520 ? 3 : 6);
  let h = ty.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#232c52"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" fill="#9aa4c6" font-size="12">${v}</text>`).join('');
  h += tx.map((v) => `<text x="${X(v)}" y="${H - m.b + 18}" text-anchor="middle" fill="#9aa4c6" font-size="12">${v}</text>`).join('');
  h += `<text x="${W - m.r}" y="${H - 4}" text-anchor="end" fill="#6c769c" font-size="12">minutes of driving, one way</text>`;
  h += N.res.map((r, i) => `<circle cx="${X(r.drive)}" cy="${Y(r.meteors)}" r="3.2" fill="#6c769c" opacity=".7" data-i="${i}" style="cursor:pointer"/>`).join('');
  const fr = N.front; let path = '';
  fr.forEach((r, i) => { path += (i ? `H${X(r.drive)}V${Y(r.meteors)}` : `M${X(r.drive)},${Y(r.meteors)}`); });
  h += `<path d="${path}" fill="none" stroke="#7fdcff" stroke-width="2"/>`;
  h += fr.map((r) => `<circle cx="${X(r.drive)}" cy="${Y(r.meteors)}" r="5.5" fill="#060914" stroke="#7fdcff" stroke-width="2" data-i="${N.res.indexOf(r)}" style="cursor:pointer"/>`).join('');
  const cur = S.cur || N.pick;
  if (cur) { const x = X(cur.drive), y = Y(cur.meteors), right = x < W * 0.6; h += `<path d="${starPath(x, y, 10)}" fill="#ffc9a3" stroke="#060914"/><text x="${right ? x + 14 : x - 14}" y="${y + 4}" text-anchor="${right ? 'start' : 'end'}" fill="#ffc9a3" font-size="13">${fmt1(cur.meteors)} in ${Math.round(cur.drive)} min</text>`; }
  svg.innerHTML = h;
  svg.onclick = (e) => { const i = e.target.dataset?.i; if (i != null) select(N.res[+i]); };
}
function niceTicks(max, n) { const step = Math.pow(10, Math.floor(Math.log10(max / n))), f = [1, 2, 5, 10].find((f) => max / (f * step) <= n) * step; const t = []; for (let v = 0; v <= max + 1e-9; v += f) t.push(+v.toFixed(2)); return t; }
function starPath(x, y, R) { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.45 : R; d += (i ? 'L' : 'M') + (x + r * Math.cos(a)).toFixed(1) + ',' + (y + r * Math.sin(a)).toFixed(1); } return d + 'Z'; }

// ---------- hours ----------
function renderHours(r, N) {
  const tz = S.origin.tz, prof = r.c.prof[S.night], rows = [];
  for (let i = 0; i + 6 <= prof.length; i += 6) {
    const seg = prof.slice(i, i + 6); if (seg[3].sunAlt > -12) continue;
    const tot = seg.reduce((a, p) => a + p.total, 0) / 6 * S.k, sh = seg.reduce((a, p) => a + p.shower, 0) / 6 * S.k, T = seg.reduce((a, p) => a + p.T, 0) / 6;
    rows.push({ t: seg[0].t, tot, sh, cl: Math.round((1 - T) * 100), inW: seg[0].t >= r.w.start && seg[0].t < r.w.end });
  }
  const mx = Math.max(...rows.map((x) => x.tot), 1);
  $('#hours').innerHTML = rows.map((x) => `<div class="hr" style="${x.inW ? '' : 'opacity:.55'}"><span>${hfmt(x.t, tz)}</span><div class="bar"><i style="width:${x.tot / mx * 100}%"></i><i class="sh" style="width:${x.sh / mx * 100}%"></i></div><span class="n">${fmt1(x.tot)}</span></div>
    <div class="hr" style="padding:0;margin-top:-4px"><span></span><span class="cl">${S.live && r.c.wx && x.cl ? x.cl + '% cloud' : ''}</span><span></span></div>`).join('') || '<p class="mute">No dark hours this night.</p>';
}

// ---------- compass ----------
function renderCompass(r) {
  const prof = r.c.prof[S.night], mid = prof[Math.floor((r.w.i + r.w.j) / 2)], sh = topShower(r);
  let h = '<circle r="100" fill="#0c1124" stroke="#232c52"/><circle r="66" fill="none" stroke="#232c52" stroke-dasharray="2 4"/><circle r="33" fill="none" stroke="#232c52" stroke-dasharray="2 4"/>';
  h += [['N', 0, -86], ['E', 86, 4], ['S', 0, 94], ['W', -86, 4]].map(([t, x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" fill="#9aa4c6" font-size="13" font-family="Sora">${t}</text>`).join('');
  const pt = (alt, az) => { const rr = (90 - alt) / 90 * 100, a = az * Math.PI / 180; return [rr * Math.sin(a), -rr * Math.cos(a)]; };
  let txt = '';
  if (sh && mid.by[sh.id] && mid.by[sh.id].alt > 0) {
    const { alt, az } = mid.by[sh.id], [x, y] = pt(alt, az), look = pt(Math.min(70, alt + 35), az);
    h += `<line x1="${x}" y1="${y}" x2="${look[0]}" y2="${look[1]}" stroke="#ffc9a3" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${x}" cy="${y}" r="7" fill="#ffc9a3"/><text x="${x}" y="${y - 12}" text-anchor="middle" fill="#ffc9a3" font-size="12">radiant</text><circle cx="${look[0]}" cy="${look[1]}" r="12" fill="none" stroke="#7fdcff" stroke-width="2"/>`;
    S.faceWord = azWord(az);
    txt = `At ${tfmt(mid.t, S.origin.tz)} the ${esc(sh.name)} radiant is ${Math.round(alt)}° up in the ${azWord(az)}. Don't stare at it: look at the blue ring, about 35° away from it, where trails run longest. ${sh.v > 60 ? 'These are fast meteors, often with glowing trains.' : sh.v < 35 ? 'These are slow meteors, easy to follow.' : ''}${alt < 15 ? ' The radiant is low: watch for long earth-grazers skimming the horizon.' : ''}`;
  } else { S.faceWord = 'overhead'; txt = 'No strong shower radiant is up. Look straight up, where the sky is darkest, and count sporadic meteors.'; }
  if (mid.moonAlt > 0) { const [x, y] = pt(mid.moonAlt, mid.moonAz); h += `<circle cx="${x}" cy="${y}" r="8" fill="#cfd6ee"/><text x="${x}" y="${y + 20}" text-anchor="middle" fill="#cfd6ee" font-size="12">moon</text>`; txt += ` The moon (${Math.round(mid.moonIllum * 100)}% lit) is up in the ${azWord(mid.moonAz)}; keep it behind you.`; }
  h += '<circle r="3" fill="#e9edf8"/><text y="16" text-anchor="middle" fill="#6c769c" font-size="11">zenith</text>';
  $('#compass').innerHTML = h; $('#faceTxt').textContent = txt;
}

// ---------- calendar ----------
function renderCalendar() {
  const o = S.origin, tz = o.tz, darkest = S.cands.length ? S.cands.reduce((b, c) => (c.drive <= S.maxMin && c.sky.sqm > b.sky.sqm ? c : b), S.cands[0]) : o;
  const sky = darkest.sky || MC.skyBrightness(IDX, o.lat, o.lon), y = new Date().getUTCFullYear(), now = Date.now();
  const rows = [...MC.showerCalendar(darkest, sky, y), ...MC.showerCalendar(darkest, sky, y + 1)].filter((r) => r.peak > now - 3 * 864e5 && r.peak < now + 365 * 864e5);
  $('#cal tbody').innerHTML = rows.map((r) => `<tr><td><b>${esc(r.sh.name)}</b></td><td>${esc(dfmt(r.peak, tz))}</td><td>${r.best.n > 0.05 ? esc(dfmt(r.best.t, tz, { month: 'short', day: 'numeric', hour: 'numeric' })) : '<span class="dim">radiant never rises well here</span>'}</td>
    <td class="num">${Math.round(r.best.moon * 100)}%${r.best.moonAlt > 0 ? ' up' : ''}</td><td class="num">${fmt1(r.best.n * S.k)}</td><td>${r.sh.v} km/s</td></tr>`).join('');
}

// ---------- search ----------
function search(q) {
  q = q.trim().toLowerCase(); if (q.length < 2) return [];
  const out = []; for (const c of NAMED) { if (c[3].toLowerCase().startsWith(q)) { out.push(c); if (out.length >= 7) break; } }
  return out;
}
function setOrigin(lat, lon, name) {
  const n = nearestNamed(lat, lon, 3000); S.origin = { lat, lon, name: name || (n ? n.name : `${lat.toFixed(2)}, ${lon.toFixed(2)}`), tz: n ? n.tz : 'UTC' };
  $('#where').value = S.origin.name; $('#sugg').style.display = 'none';
}
$('#where').addEventListener('input', (e) => {
  const v = e.target.value, m = v.match(/^\s*(-?\d+(\.\d+)?)\s*[, ]\s*(-?\d+(\.\d+)?)\s*$/), box = $('#sugg');
  if (m) { box.innerHTML = `<button type="button" data-ll="${m[1]},${m[3]}">Use ${m[1]}, ${m[3]}</button>`; box.style.display = 'block'; return; }
  const r = search(v); box.innerHTML = r.map((c) => `<button type="button" data-ll="${c[0]},${c[1]}" data-name="${esc(c[3])}"><span>${esc(c[3])}</span><span class="dim">${Math.round(c[2])}k</span></button>`).join('');
  box.style.display = r.length ? 'block' : 'none';
});
$('#sugg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const [la, lo] = b.dataset.ll.split(',').map(Number); setOrigin(la, lo, b.dataset.name); go(); });
$('#form').addEventListener('submit', (e) => { e.preventDefault(); const b = $('#sugg button'); if (b) b.click(); });
$('#geo').onclick = () => {
  if (!navigator.geolocation) return toast('Location not available here');
  navigator.geolocation.getCurrentPosition((p) => { setOrigin(p.coords.latitude, p.coords.longitude); go(); }, () => toast('Location blocked here; type a city'));
};

// ---------- controls ----------
const bindRange = (id, key, f, lazy) => { const el = $('#' + id), lab = $('#' + id + 'V'); el.value = S[key]; lab.textContent = f(S[key]);
  el.addEventListener('input', () => { S[key] = +el.value; lab.textContent = f(S[key]); if (lazy) lazy(); }); };
let tmr; const soon = (fn) => { clearTimeout(tmr); tmr = setTimeout(fn, 120); };
bindRange('maxMin', 'maxMin', (v) => v + ' min');
$('#maxMin').addEventListener('change', go);
bindRange('watch', 'watch', (v) => v + ' h', () => soon(() => evaluate(false)));
bindRange('vot', 'vot', (v) => v + ' meteors', () => soon(() => evaluate(false)));
bindRange('cloud', 'cloud', (v) => v + '%');
$('#cloud').addEventListener('change', () => evaluate(true));
$('#date').value = S.date; $('#date').addEventListener('change', (e) => { S.date = e.target.value || todayISO(); go(); });
$$('[data-count]').forEach((b) => b.addEventListener('click', () => { S.count = b.dataset.count; $$('[data-count]').forEach((x) => x.setAttribute('aria-pressed', x === b)); evaluate(false); }));
$('#nights').addEventListener('click', (e) => { const b = e.target.closest('.night'); if (!b) return; S.night = +b.dataset.n; S.sel = null; S.cur = null; render(); });
$('#go').onclick = go;
let busy = false;
async function go() { if (busy) return; busy = true; $('#go').textContent = 'Working…'; S.night = 0; S.cur = null; try { await run(); renderCalendar(); } finally { busy = false; $('#go').textContent = 'Find the sky'; } }
const calNow = () => ($('#calNow').textContent = S.k === 1 ? 'Using the model as is.' : `Your eyes: ×${S.k.toFixed(2)}`);
$('#calSave').onclick = () => { const p = +$('#calPred').value, s = +$('#calSeen').value; if (!(p > 0) || !(s >= 0)) return toast('Enter both numbers'); S.k = Math.max(0.1, Math.min(5, s / p * S.k)); store.set('k', S.k); calNow(); evaluate(false); renderCalendar(); toast('Saved'); };
$('#calReset').onclick = () => { S.k = 1; store.set('k', 1); calNow(); evaluate(false); renderCalendar(); };

// ---------- parking (Overpass) ----------
$('#findPark').onclick = async () => {
  const r = S.cur; if (!r) return; const ul = $('#parking');
  if (!S.live) { ul.innerHTML = '<li class="mute">This copy can\'t reach OpenStreetMap. Open the live version from GitHub to search parking.</li>'; return; }
  ul.innerHTML = '<li class="mute">Searching OpenStreetMap…</li>';
  const { lat, lon } = r.c, a = `(around:4000,${lat},${lon})`;
  const q = `[out:json][timeout:20];(nwr${a}[amenity=parking];nwr${a}[tourism~"^(viewpoint|camp_site|picnic_site)$"];nwr${a}[highway=rest_area];nwr${a}[leisure=picnic_table];);out center 60;`;
  try {
    const j = await fetchT('https://overpass-api.de/api/interpreter', 25000, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const kind = (t) => t.tourism === 'viewpoint' ? 'Viewpoint' : t.tourism === 'camp_site' ? 'Campground' : t.tourism === 'picnic_site' || t.leisure ? 'Picnic area' : t.highway === 'rest_area' ? 'Rest area' : 'Parking';
    const rank = { Viewpoint: 0, Campground: 1, 'Rest area': 2, 'Picnic area': 3, Parking: 4 };
    const items = j.elements.map((e) => { const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, t = e.tags || {}; return { la, lo, t, k: kind(t), d: MC.hav(lat, lon, la, lo) }; })
      .filter((x) => x.la != null && !/private|customers|no/.test(x.t.access || '')).sort((a, b) => rank[a.k] - rank[b.k] || a.d - b.d).slice(0, 8);
    ul.innerHTML = items.length ? items.map((x) => `<li><b>${esc(x.t.name || x.k)}</b> <span class="mute">· ${x.k} · ${x.d.toFixed(1)} km${x.t.lit === 'yes' ? ' · lit' : ''}${x.t.fee === 'yes' ? ' · fee' : ''}${x.t.opening_hours ? ' · ' + esc(x.t.opening_hours) : ''}</span><br>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${x.la.toFixed(5)},${x.lo.toFixed(5)}" target="_blank" rel="noopener">Directions</a> <span class="mono dim">${x.la.toFixed(4)}, ${x.lo.toFixed(4)}</span></li>`).join('') +
      '<li class="note">From OpenStreetMap. Check posted hours and signs: some lots close at sunset.</li>' : '<li class="mute">Nothing mapped within 4 km. Try a frontier site nearby.</li>';
  } catch { ul.innerHTML = '<li class="mute">OpenStreetMap didn\'t answer. Try again in a minute.</li>'; }
};

// ---------- boot ----------
const ro = new ResizeObserver(() => { if (S.nights.length) { drawMap(); drawPareto(); } }); ro.observe($('#map')); ro.observe($('#pareto'));
(async () => {
  try {
    const [c, l] = await Promise.all([fetch('cities.json').then((r) => r.json()), fetch('land.json').then((r) => r.json())]);
    TZ = c.tz; CITIES = c.c; NAMED = CITIES.filter((x) => x.length > 3); IDX = MC.buildCityIndex(CITIES); LAND = MC.landLookup(l);
  } catch { $('#mode').textContent = 'Could not load sky data'; return; }
  calNow();
  S.live = await probeLive();
  $('#mode').className = 'pill ' + (S.live ? 'live' : 'off');
  $('#mode').textContent = S.live ? '● Live forecast' : '○ Clear-sky model';
  if (!S.live) { $('#cloudWrap').style.display = 'block'; $('#cloud').value = S.cloud; $('#cloudV').textContent = S.cloud + '%'; $('#parkIntro').textContent = 'Live parking search needs the GitHub version of the app; this copy can\'t reach outside data.'; }
  $('#where').value = S.origin.name;
  go();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai')) { try { navigator.serviceWorker.register('sw.js'); } catch {} }
})();
}
