/* Meteor Chaser model — pure functions, no DOM. Runs in the browser and in Node.
 *
 * Expected meteors seen by one observer at a site over a window:
 *   N = Σ_t [ ZHR(λ⊙) · sin(h_radiant) · r^(LM−6.5) + HR_sporadic(t) · 3^(LM−6.5) ] · T_cloud · k_personal · Δt
 * where LM (naked-eye limiting magnitude) comes from:
 *   sky brightness (Walker's law over every city ≥15k people) → SQM → LM,
 *   + elevation bonus, − twilight, − moonlight.
 */
(function (root) {
  'use strict';
  const D = Math.PI / 180, R = 180 / Math.PI;
  const norm = (x) => ((x % 360) + 360) % 360;

  // ---------- time ----------
  const jd = (date) => date.getTime() / 86400000 + 2440587.5;
  const gmst = (J) => norm(280.46061837 + 360.98564736629 * (J - 2451545));

  // ---------- Sun (Meeus low precision, ~0.01°) ----------
  function sun(J) {
    const T = (J - 2451545) / 36525;
    const L0 = norm(280.46646 + 36000.76983 * T);
    const M = norm(357.52911 + 35999.05029 * T) * D;
    const C = (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    const lon = norm(L0 + C);
    const eps = (23.439291 - 0.0130042 * T) * D;
    const ra = norm(Math.atan2(Math.cos(eps) * Math.sin(lon * D), Math.cos(lon * D)) * R);
    const dec = Math.asin(Math.sin(eps) * Math.sin(lon * D)) * R;
    // λ⊙ in J2000 (IMO convention): remove precession since J2000
    const lambda2000 = norm(lon - 1.3970 * T);
    return { ra, dec, lon, lambda2000 };
  }

  // ---------- Moon (truncated Meeus/ELP, ~0.3°) ----------
  function moon(J) {
    const d = J - 2451545, T = d / 36525;
    const Lp = norm(218.3164477 + 481267.88123421 * T);
    const Dm = norm(297.8501921 + 445267.1114034 * T) * D;
    const M = norm(357.5291092 + 35999.0502909 * T) * D;
    const Mp = norm(134.9633964 + 477198.8675055 * T) * D;
    const F = norm(93.272095 + 483202.0175233 * T) * D;
    const lon = Lp + 6.289 * Math.sin(Mp) + 1.274 * Math.sin(2 * Dm - Mp) + 0.658 * Math.sin(2 * Dm)
      + 0.214 * Math.sin(2 * Mp) - 0.186 * Math.sin(M) - 0.114 * Math.sin(2 * F)
      + 0.059 * Math.sin(2 * Dm - 2 * Mp) + 0.057 * Math.sin(2 * Dm - M - Mp) + 0.053 * Math.sin(2 * Dm + Mp);
    const lat = 5.128 * Math.sin(F) + 0.281 * Math.sin(Mp + F) + 0.278 * Math.sin(Mp - F) + 0.173 * Math.sin(2 * Dm - F);
    const eps = 23.439 * D, l = lon * D, b = lat * D;
    const ra = norm(Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l)) * R);
    const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l)) * R;
    const s = sun(J);
    const elong = Math.acos(Math.cos(b) * Math.cos((lon - s.lon) * D));
    const illum = (1 - Math.cos(elong)) / 2; // phase-angle ≈ π − elongation
    return { ra, dec, illum, topo: true };
  }
  // J2000 → equinox of date (radiants are catalogued in J2000)
  function precess(ra, dec, J) {
    const y = (J - 2451545) / 365.25, a = ra * D, d = Math.max(-89, Math.min(89, dec)) * D;
    return { ra: norm(ra + (0.012811 + 0.005567 * Math.sin(a) * Math.tan(d)) * y), dec: dec + 0.005567 * Math.cos(a) * y };
  }
  // Moon altitude: geocentric → topocentric (horizontal parallax ≈ 0.95°)
  const moonTopo = (alt) => alt - 0.95 * Math.cos(alt * D);

  // ---------- horizontal coordinates ----------
  function altaz(ra, dec, lat, lon, J) {
    const H = (gmst(J) + lon - ra) * D, d = dec * D, p = lat * D;
    const sa = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
    const alt = Math.asin(sa);
    const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H));
    return { alt: alt * R, az: norm(az * R) };
  }

  // ---------- shower catalog (IMO working list, J2000 radiants at peak) ----------
  // lam: peak λ⊙; zhr; r: population index; v km/s; B: activity slope (ZHR = ZHRmax·10^(−B|Δλ|)),
  // Bf: fall slope if asymmetric; dra/ddec: radiant drift per degree of λ⊙; act: active λ⊙ range
  const SHOWERS = [
    { id: 'QUA', name: 'Quadrantids', lam: 283.15, ra: 230, dec: 49, zhr: 80, r: 2.1, v: 41, B: 2.5, dra: 0.8, ddec: -0.2, act: [277, 293] },
    { id: 'LYR', name: 'Lyrids', lam: 32.32, ra: 271, dec: 34, zhr: 18, r: 2.1, v: 49, B: 0.22, dra: 1.1, ddec: 0, act: [26, 38] },
    { id: 'ETA', name: 'eta Aquariids', lam: 45.5, ra: 338, dec: -1, zhr: 50, r: 2.4, v: 66, B: 0.08, dra: 0.9, ddec: 0.4, act: [29, 65] },
    { id: 'SDA', name: 'Southern delta Aquariids', lam: 127, ra: 340, dec: -16, zhr: 25, r: 3.2, v: 41, B: 0.091, dra: 0.8, ddec: 0.18, act: [100, 155] },
    { id: 'CAP', name: 'alpha Capricornids', lam: 127, ra: 306, dec: -9, zhr: 5, r: 2.5, v: 23, B: 0.13, dra: 0.54, ddec: 0.25, act: [100, 155] },
    { id: 'PER', name: 'Perseids', lam: 140.0, ra: 48, dec: 58, zhr: 100, r: 2.2, v: 59, B: 0.35, Bf: 0.20, dra: 1.35, ddec: 0.12, act: [113, 157] },
    { id: 'DRA', name: 'Draconids', lam: 195.07, ra: 262, dec: 54, zhr: 10, r: 2.6, v: 20, B: 1.5, dra: 0, ddec: 0, act: [193, 198] },
    { id: 'STA', name: 'Southern Taurids', lam: 197, ra: 32, dec: 9, zhr: 5, r: 2.3, v: 27, B: 0.026, dra: 0.78, ddec: 0.15, act: [167, 238] },
    { id: 'ORI', name: 'Orionids', lam: 208, ra: 95, dec: 16, zhr: 20, r: 2.5, v: 66, B: 0.12, dra: 0.7, ddec: 0.1, act: [189, 236] },
    { id: 'NTA', name: 'Northern Taurids', lam: 230, ra: 58, dec: 22, zhr: 5, r: 2.3, v: 29, B: 0.026, dra: 0.76, ddec: 0.1, act: [197, 251] },
    { id: 'LEO', name: 'Leonids', lam: 235.27, ra: 152, dec: 22, zhr: 15, r: 2.5, v: 71, B: 0.39, dra: 0.7, ddec: -0.42, act: [225, 249] },
    { id: 'GEM', name: 'Geminids', lam: 262.2, ra: 112, dec: 33, zhr: 150, r: 2.6, v: 35, B: 0.39, Bf: 0.81, dra: 1.0, ddec: -0.15, act: [252, 266] },
    { id: 'URS', name: 'Ursids', lam: 270.7, ra: 217, dec: 76, zhr: 10, r: 3.0, v: 33, B: 0.9, dra: -0.2, ddec: -0.3, act: [266, 274] },
    { id: 'ACE', name: 'alpha Centaurids', lam: 319.2, ra: 210, dec: -59, zhr: 6, r: 2.0, v: 58, B: 0.2, dra: 1.1, ddec: -0.3, act: [305, 330] },
  ];

  const dLam = (a, b) => { let d = norm(a - b); return d > 180 ? d - 360 : d; };
  function inRange(lam, act) { const [a, b] = act; return a <= b ? lam >= a && lam <= b : lam >= a || lam <= b; }
  function zhrAt(sh, lam) {
    if (!inRange(lam, sh.act)) return 0;
    const d = dLam(lam, sh.lam);
    const B = d > 0 && sh.Bf ? sh.Bf : sh.B;
    return sh.zhr * Math.pow(10, -B * Math.abs(d));
  }
  function radiant(sh, lam) { const d = dLam(lam, sh.lam); return { ra: norm(sh.ra + sh.dra * d), dec: sh.dec + sh.ddec * d }; }

  // ---------- light pollution (Walker's law) ----------
  // ratio of artificial to natural zenith brightness = 0.01 · Σ P · d^−2.5 (d km, P people)
  // Cities are binned on a 1° grid so a site only sums its neighbours (≤ 400 km).
  function buildCityIndex(cities) {
    const bins = new Map();
    for (const c of cities) { const k = Math.floor(c[0]) + ',' + Math.floor(c[1]); (bins.get(k) || bins.set(k, []).get(k)).push(c); }
    return { bins, all: cities };
  }
  function hav(la1, lo1, la2, lo2) {
    const a = Math.sin((la2 - la1) * D / 2) ** 2 + Math.cos(la1 * D) * Math.cos(la2 * D) * Math.sin((lo2 - lo1) * D / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
  }
  function skyBrightness(idx, lat, lon, opts = {}) {
    const k = (opts.lightFactor ?? 1) * 0.3, reach = 400, n = Math.ceil(reach / 85);
    let sum = 0, nearest = null, nearestD = 1e9;
    const la0 = Math.floor(lat), lo0 = Math.floor(lon);
    for (let i = -4; i <= 4; i++) for (let j = -n; j <= n; j++) {
      const list = idx.bins.get((la0 + i) + ',' + (((lo0 + j + 540) % 360) - 180)); if (!list) continue;
      for (const c of list) {
        const d = hav(lat, lon, c[0], c[1]); if (d > reach) continue;
        const P = c[2] * 1000, rc = Math.sqrt(P / 3000 / Math.PI); // city radius at ~3000/km²
        sum += P * Math.pow(Math.max(d, rc, 1), -2.5);
        if (c[3] && c[2] >= 50 && d < nearestD) { nearestD = d; nearest = c[3]; }
      }
    }
    const ratio = 0.01 * sum * k; // 0.3 × Walker: fit to measured SQM at 5 SoCal sites (rms 0.09 mag)
    const sqm = 21.9 - 2.5 * Math.log10(1 + ratio);
    return { sqm, ratio, bortle: bortle(sqm), nearTown: nearest, nearTownKm: nearestD };
  }
  function bortle(sqm) { const t = [21.99, 21.89, 21.69, 20.49, 19.5, 18.94, 18.38, 17.8]; for (let i = 0; i < t.length; i++) if (sqm >= t[i]) return i + 1; return 9; }
  const nelm = (sqm) => 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - sqm / 5) + 1);

  // ---------- land mask ----------
  function landLookup(mask) {
    const { res, rows } = mask;
    return (lat, lon) => {
      const i = Math.floor((90 - lat) / res), j = Math.floor((((lon + 180) % 360 + 360) % 360) / res);
      const runs = rows[Math.max(0, Math.min(rows.length - 1, i))]; let acc = 0, land = false;
      for (const k of runs) { if (j < acc + k) return land; acc += k; land = !land; }
      return land;
    };
  }

  // ---------- transparency from cloud layers ----------
  // Thin high cloud (cirrus) dims rather than blocks: weight 0.5. Low/mid block.
  function transparency(w) {
    if (!w) return 1;
    if (w.low == null) return Math.max(0, 1 - (w.total ?? 0) / 100);
    return (1 - w.low / 100) * (1 - w.mid / 100) * (1 - 0.5 * w.high / 100);
  }

  // ---------- instantaneous rates ----------
  function conditions(site, J, sky) {
    const s = sun(J), m = moon(J);
    const sAlt = altaz(s.ra, s.dec, site.lat, site.lon, J).alt;
    const mPos = altaz(m.ra, m.dec, site.lat, site.lon, J); mPos.alt = moonTopo(mPos.alt);
    let lm = nelm(sky.sqm) + Math.min(0.4, Math.max(0, (site.elev || 0) / 1000 * 0.15));
    if (sAlt > -18) lm -= Math.min(4, (sAlt + 18) * 0.35);
    if (mPos.alt > 0) lm -= m.illum * (0.3 + 1.2 * Math.sin(mPos.alt * D));
    return { lam: s.lambda2000, sunAlt: sAlt, moonAlt: mPos.alt, moonAz: mPos.az, moonIllum: m.illum, lm: Math.max(0, lm) };
  }
  function sporadicHR(site, J) {
    // diurnal: apex rises toward ~6h local mean solar time; ~2/h evening → ~10/h dawn at LM 6.5
    const solarHour = (((J - Math.floor(J)) * 24 + 12 + site.lon / 15) % 24 + 24) % 24;
    const ns = site.lat >= 0 ? 1 : -1, s = sun(J);
    const season = 1 + 0.25 * ns * Math.cos((s.lambda2000 - 210) * D); // northern autumn high
    return (6 + 4 * Math.cos(2 * Math.PI * (solarHour - 6) / 24)) * season;
  }
  function rates(site, J, sky, showers, w, k = 1) {
    const c = conditions(site, J, sky), T = transparency(w);
    if (c.sunAlt > -8) return { ...c, T, shower: 0, bright: 0, spor: 0, total: 0, by: {} };
    const by = {}; let shower = 0, bright = 0;
    for (const sh of showers) {
      const z = zhrAt(sh, c.lam); if (!z) continue;
      const r0 = radiant(sh, c.lam), rp = precess(r0.ra, r0.dec, J), aa = altaz(rp.ra, rp.dec, site.lat, site.lon, J);
      if (aa.alt <= 0) { by[sh.id] = { n: 0, alt: aa.alt, az: aa.az, zhr: z }; continue; }
      const n = z * Math.sin(aa.alt * D) * Math.pow(sh.r, c.lm - 6.5) * T * k;
      by[sh.id] = { n, alt: aa.alt, az: aa.az, zhr: z };
      shower += n; bright += n * Math.min(1, Math.pow(sh.r, 2 - c.lm + 2.5));
    }
    const spor = sporadicHR(site, J) * Math.pow(3.0, c.lm - 6.5) * T * k;
    bright += spor * Math.min(1, Math.pow(3.0, 2 - c.lm + 2.5));
    return { ...c, T, shower, spor, bright, total: shower + spor, by };
  }

  // ---------- night integration ----------
  // weatherAt(J) → {low,mid,high,temp,wind,feels} or null. Steps every 10 min.
  function nightProfile(site, nightStart, hours, sky, showers, weatherAt, k = 1, stepMin = 10) {
    const out = [], J0 = jd(nightStart);
    for (let m = 0; m <= hours * 60; m += stepMin) {
      const J = J0 + m / 1440, w = weatherAt ? weatherAt(J) : null;
      out.push({ t: new Date(nightStart.getTime() + m * 60000), J, w, ...rates(site, J, sky, showers, w, k) });
    }
    return out;
  }
  function bestWindow(profile, watchHours, stepMin = 10) {
    const n = Math.round(watchHours * 60 / stepMin); let best = null;
    for (let i = 0; i + n < profile.length; i++) {
      let tot = 0, sh = 0, br = 0;
      for (let j = i; j < i + n; j++) { const f = stepMin / 60; tot += profile[j].total * f; sh += profile[j].shower * f; br += profile[j].bright * f; }
      if (!best || tot > best.total) best = { i, j: i + n, start: profile[i].t, end: profile[i + n].t, total: tot, shower: sh, bright: br };
    }
    if (best) {
      const seg = profile.slice(best.i, best.j + 1);
      best.minFeels = Math.min(...seg.map((p) => p.w?.feels ?? Infinity));
      best.meanT = seg.reduce((a, p) => a + p.T, 0) / seg.length;
      best.maxWind = Math.max(...seg.map((p) => p.w?.wind ?? 0));
    }
    return best;
  }

  // ---------- Pareto ----------
  // objectives: array of {key, dir: +1 maximise / −1 minimise}
  function pareto(items, objectives) {
    const dom = (a, b) => { let better = false; for (const o of objectives) { const x = a[o.key] * o.dir, y = b[o.key] * o.dir; if (x < y) return false; if (x > y) better = true; } return better; };
    return items.filter((a) => !items.some((b) => b !== a && dom(b, a)));
  }
  function knee(front, xKey, yKey) {
    if (front.length < 3) return front[front.length - 1];
    const xs = front.map((f) => f[xKey]), ys = front.map((f) => f[yKey]);
    const nx = (v) => (v - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1), ny = (v) => (v - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys) || 1);
    // distance above the chord from cheapest to richest; x = cost (min), y = reward (max)
    return front.reduce((b, f) => { const d = ny(f[yKey]) - nx(f[xKey]); return !b || d > b.d ? { d, f } : b; }, null).f;
  }

  // ---------- candidate sites ----------
  function candidates(origin, maxKm, isLand, nRings = 7, perRing = 18) {
    const out = [{ lat: origin.lat, lon: origin.lon, ring: 0 }];
    for (let r = 1; r <= nRings; r++) {
      const km = maxKm * Math.pow(r / nRings, 0.9), n = Math.round(perRing * r / nRings * 1.6) + 6;
      for (let i = 0; i < n; i++) {
        const b = (i / n * 360 + r * 11) * D, dl = km / 6371;
        const la = Math.asin(Math.sin(origin.lat * D) * Math.cos(dl) + Math.cos(origin.lat * D) * Math.sin(dl) * Math.cos(b));
        const lo = origin.lon * D + Math.atan2(Math.sin(b) * Math.sin(dl) * Math.cos(origin.lat * D), Math.cos(dl) - Math.sin(origin.lat * D) * Math.sin(la));
        const p = { lat: la * R, lon: ((lo * R + 540) % 360) - 180, ring: r, km };
        if (!isLand || isLand(p.lat, p.lon)) out.push(p);
      }
    }
    return out;
  }
  const estDriveMin = (km) => km < 1 ? 0 : (km * 1.32) / (km < 40 ? 50 : km < 120 ? 72 : 85) * 60 + 8;

  // ---------- calendar: best nights for each shower over a year ----------
  function showerCalendar(site, sky, year) {
    const rows = [];
    for (const sh of SHOWERS) {
      // find date when sun reaches sh.lam
      let J = jd(new Date(Date.UTC(year, 0, 1)));
      J += norm(sh.lam - sun(J).lambda2000) / 0.9856; // always step forward within the year
      for (let i = 0; i < 20 && Math.abs(dLam(sun(J).lambda2000, sh.lam)) > 0.001; i++) J += dLam(sh.lam, sun(J).lambda2000) / 0.9856;
      const peak = new Date((J - 2440587.5) * 86400000);
      // best 1-h window within ±18 h of peak, by expected meteors at this site (clear sky)
      let best = null;
      for (let h = -18; h <= 18; h += 0.25) {
        const Jt = J + h / 24, r = rates(site, Jt, sky, [sh], null);
        const n = r.by[sh.id]?.n || 0;
        if (!best || n > best.n) best = { n, J: Jt, moon: r.moonIllum, moonAlt: r.moonAlt };
      }
      rows.push({ sh, peak, best: { ...best, t: new Date((best.J - 2440587.5) * 86400000) } });
    }
    return rows.sort((a, b) => a.peak - b.peak);
  }

  const API = { jd, gmst, sun, moon, altaz, precess, moonTopo, SHOWERS, zhrAt, radiant, buildCityIndex, skyBrightness, bortle, nelm, landLookup,
    transparency, conditions, rates, nightProfile, bestWindow, pareto, knee, candidates, estDriveMin, hav, showerCalendar, sporadicHR };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.MC = API;
})(typeof self !== 'undefined' ? self : this);
