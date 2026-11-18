// Back-test: the two nights of 17–18 Nov 2026. Run: node tests/leonids2026.test.js
const M = require('../web/model.js'), fs = require('fs'), assert = require('assert');
const idx = M.buildCityIndex(JSON.parse(fs.readFileSync(__dirname + '/../web/cities.json')).c);
const land = M.landLookup(JSON.parse(fs.readFileSync(__dirname + '/../web/land.json')));
const sites = { 'Westwood (UCLA)': [34.07, -118.44, 120], 'Lois Ewen': [34.081, -118.641, 720], 'Circle X': [34.112, -118.931, 620],
  'Mt Pinos': [34.813, -119.127, 2530], 'Red Rock Cyn': [35.371, -117.991, 810], 'Jawbone': [35.30, -118.0, 650], 'Joshua Tree S': [33.74, -115.82, 960] };
const sky = {};
for (const [n, [la, lo, el]] of Object.entries(sites)) { sky[n] = M.skyBrightness(idx, la, lo); console.log(n.padEnd(16), 'SQM', sky[n].sqm.toFixed(2), 'Bortle', sky[n].bortle, 'LM', M.nelm(sky[n].sqm).toFixed(2), 'land', land(la, lo)); }
const night = (d) => new Date(d); // 22:00 PST = 06:00 UTC
for (const [label, start, cloud] of [['Mon→Tue  Circle X 2:30–4:00, 25% cloud', '2026-11-17T10:30:00Z', 25], ['Tue→Wed  Red Rock 1:45–5:00, 12% cloud', '2026-11-18T09:45:00Z', 12]]) {
  const site = label.includes('Circle') ? 'Circle X' : 'Red Rock Cyn', [la, lo, el] = sites[site];
  const hrs = label.includes('Circle') ? 1.5 : 3.25;
  const p = M.nightProfile({ lat: la, lon: lo, elev: el }, night(start), hrs, sky[site], M.SHOWERS, () => ({ total: cloud }));
  const w = M.bestWindow(p, hrs - 0.01);
  console.log(label, '→ total', w.total.toFixed(1), 'Leonid', (p.reduce((a, x) => a + (x.by.LEO?.n || 0), 0) / 6).toFixed(1), 'bright', w.bright.toFixed(1));
}
// activity curve sanity
const lamPeak = M.SHOWERS.find((s) => s.id === 'LEO');
assert(Math.abs(M.zhrAt(lamPeak, 235.27) - 15) < 1e-9);
assert(M.zhrAt(lamPeak, 260) === 0);
// darkness ordering: city < coast mountains < desert
assert(sky['Westwood (UCLA)'].sqm < sky['Circle X'].sqm && sky['Circle X'].sqm < sky['Red Rock Cyn'].sqm);
assert(!land(33.9, -119.6) && land(35.3, -118.0));
// pareto
const f = M.pareto([{ a: 1, b: 1 }, { a: 2, b: 2 }, { a: 1, b: 3 }, { a: 3, b: 3 }], [{ key: 'a', dir: 1 }, { key: 'b', dir: -1 }]);
assert.deepStrictEqual(f.map((x) => x.a + ',' + x.b).sort(), ['1,1', '2,2', '3,3']);
console.log('all assertions passed');
