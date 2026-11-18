#!/usr/bin/env node
// Meteor Chaser from the terminal (clear-sky model, estimated drive times).
// Usage: node cli.js --lat 34.07 --lon -118.44 [--date 2026-12-13] [--max 120] [--watch 3] [--cloud 10] [--vot 4] [--tz America/Los_Angeles]
const M = require('./web/model.js'), fs = require('fs'), path = require('path');
const a = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ')]; }));
if (!a.lat || !a.lon) { console.log('Usage: node cli.js --lat 34.07 --lon -118.44 [--date YYYY-MM-DD] [--max 120] [--watch 3] [--cloud 10] [--vot 4] [--tz Area/City]'); process.exit(1); }
const lat = +a.lat, lon = +a.lon, maxMin = +(a.max || 120), watch = +(a.watch || 3), cloud = +(a.cloud || 0), vot = +(a.vot || 4);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'web/cities.json')));
const idx = M.buildCityIndex(data.c), land = M.landLookup(JSON.parse(fs.readFileSync(path.join(__dirname, 'web/land.json'))));
const named = data.c.filter((c) => c.length > 3);
const near = named.reduce((b, c) => { const d = M.hav(lat, lon, c[0], c[1]); return d < b.d ? { d, c } : b; }, { d: 1e9 });
const tz = a.tz || data.tz[near.c[4]];
const off = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value])); return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - d) / 6e4; };
const iso = a.date || new Date().toISOString().slice(0, 10), [y, mo, d] = iso.split('-').map(Number), t0 = Date.UTC(y, mo - 1, d, 17);
const start = new Date(t0 - off(new Date(t0)) * 6e4);
const t = (x) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(Math.round(x / 3e5) * 3e5));
const maxKm = (maxMin - 8) / 60 * 80 / 1.32;
const res = M.candidates({ lat, lon }, maxKm, land).map((c, i) => {
  c.sky = M.skyBrightness(idx, c.lat, c.lon); c.drive = i ? M.estDriveMin(c.km) : 0;
  const w = M.bestWindow(M.nightProfile(c, start, 15, c.sky, M.SHOWERS, () => ({ total: cloud })), watch);
  return { c, w, meteors: w.total, drive: c.drive, util: w.total - vot * 2 * c.drive / 60 };
}).filter((r) => r.drive <= maxMin);
const front = M.pareto(res, [{ key: 'meteors', dir: 1 }, { key: 'drive', dir: -1 }]).sort((a, b) => a.drive - b.drive);
const pick = res.reduce((b, r) => (r.util > b.util ? r : b));
console.log(`\nNight of ${iso} from ${near.c[3]} (${tz}), ${watch} h watch, ${cloud}% cloud\n`);
console.log('Pareto frontier'.padEnd(26) + 'drive  meteors  bright  SQM    watch');
for (const r of front) console.log(`${r === pick ? '★ ' : '  '}${r.c.lat.toFixed(3)}, ${r.c.lon.toFixed(3)}`.padEnd(26) + `${String(Math.round(r.drive)).padStart(4)}m  ${r.meteors.toFixed(1).padStart(7)}  ${r.w.bright.toFixed(1).padStart(6)}  ${r.c.sky.sqm.toFixed(2)}  ${t(r.w.start)}–${t(r.w.end)}`);
console.log(`\n★ Leave ${t(pick.w.start - pick.drive * 6e4)}, watch ${t(pick.w.start)}–${t(pick.w.end)}, home ${t(+pick.w.end + pick.drive * 6e4)}.`);
console.log(`  https://www.google.com/maps/dir/?api=1&destination=${pick.c.lat.toFixed(5)},${pick.c.lon.toFixed(5)}\n`);
