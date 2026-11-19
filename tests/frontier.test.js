// Worked example + properties of the frontier and the scalarised pick.
// Night of 17→18 Nov 2026 from Westwood, 120 min reach, 3 h watch, uniform 12% cloud (offline mode).
const M = require('../web/model.js'), fs = require('fs'), assert = require('assert');
const data = JSON.parse(fs.readFileSync(__dirname + '/../web/cities.json'));
const idx = M.buildCityIndex(data.c), land = M.landLookup(JSON.parse(fs.readFileSync(__dirname + '/../web/land.json')));
const o = { lat: 34.07, lon: -118.44 }, Dmax = 120, W = 3, start = new Date('2026-11-18T01:00:00Z'); // 17:00 PST
const R = (Dmax - 8) / 60 * 80 / 1.32;
const res = M.candidates(o, R, land).map((c, i) => {
  c.sky = M.skyBrightness(idx, c.lat, c.lon); c.drive = i ? M.estDriveMin(c.km) : 0;
  const w = M.bestWindow(M.nightProfile(c, start, 15, c.sky, M.SHOWERS, () => ({ total: 12 })), W);
  return { c, w, N: w.total, tau: c.drive };
}).filter((r) => r.tau <= Dmax);
const F = M.pareto(res, [{ key: 'N', dir: 1 }, { key: 'tau', dir: -1 }]).sort((a, b) => a.tau - b.tau);
// (P1) no frontier point is dominated; every non-frontier point is dominated by some frontier point
for (const a of F) assert(!res.some((b) => b.N >= a.N && b.tau <= a.tau && (b.N > a.N || b.tau < a.tau)));
for (const a of res.filter((r) => !F.includes(r))) assert(F.some((b) => b.N >= a.N && b.tau <= a.tau && (b.N > a.N || b.tau < a.tau)));
// (P2) the frontier is strictly increasing in both coordinates when sorted by tau
for (let i = 1; i < F.length; i++) assert(F[i].tau > F[i - 1].tau && F[i].N > F[i - 1].N);
// (P3) for every v ≥ 0 the maximiser of U = N − 2vτ/60 lies on F; collect which frontier points are ever chosen
const picked = new Set();
for (let v = 0; v <= 60; v += 0.05) {
  const best = res.reduce((b, r) => (r.N - 2 * v * r.tau / 60 > b.N - 2 * v * b.tau / 60 + 1e-12 ? r : b));
  assert(F.includes(best) || F.some((f) => f.N === best.N && f.tau === best.tau)); picked.add(F.find((f) => f.N === best.N && f.tau === best.tau));
}
// (P4) the chosen points are exactly the vertices of the upper-left convex hull of F
const hull = []; for (const p of F) { while (hull.length >= 2) { const [a, b] = hull.slice(-2); if ((b.tau - a.tau) * (p.N - a.N) - (b.N - a.N) * (p.tau - a.tau) >= 0) hull.pop(); else break; } hull.push(p); }
assert.deepStrictEqual([...picked].sort((a, b) => a.tau - b.tau).map((x) => x.tau), hull.map((x) => x.tau));
console.log(`candidates ${res.length}, frontier ${F.length}, supported ${hull.length}`);
console.log('tau(min)  N     SQM    LM*   window(UTC)        supported');
for (const f of F) console.log(`${f.tau.toFixed(0).padStart(5)}  ${f.N.toFixed(1).padStart(5)}  ${f.c.sky.sqm.toFixed(2)}  ${M.nelm(f.c.sky.sqm).toFixed(2)}  ${f.w.start.toISOString().slice(11, 16)}–${f.w.end.toISOString().slice(11, 16)}  ${hull.includes(f) ? 'yes' : 'no'}  ${f.c.lat.toFixed(3)},${f.c.lon.toFixed(3)}`);
const pick = res.reduce((b, r) => (r.N - 8 * r.tau / 60 > b.N - 8 * b.tau / 60 ? r : b));
console.log(`v = 4 pick: tau ${pick.tau.toFixed(0)} min, N ${pick.N.toFixed(1)}`);
console.log('frontier properties P1–P4 hold');
