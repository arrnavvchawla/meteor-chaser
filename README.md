# Meteor Chaser

**Where to drive tonight, and when to look up, to see the most meteors for the least road.** Anywhere on Earth.

Built after two nights chasing the 2026 Leonids out of Los Angeles: Circle X at Sandstone Peak on night one, Red Rock Canyon on night two. Every choice those nights came down to the same trade: more darkness costs more road. This app makes that trade explicit, and finds the sites nobody can beat on both.

## What it does

Give it a starting point, a night, how far you'll drive and how long you'll watch. It:

1. **Drops ~150 candidate sites** in rings around you, on land only (0.05° global land mask).
2. **Measures each one's sky darkness** from the glow of every city on Earth over 15,000 people (Walker's law, 33,961 cities, fitted to measured sky brightness).
3. **Pulls the hourly forecast for every site** (low, mid and high cloud separately, temperature, wind chill), its elevation, and its real drive time by road. Routing also snaps each site onto a real road and throws out the ones in the sea or roadless wilderness.
4. **Counts meteors every 10 minutes for 7 nights**: each active shower's ZHR at that solar longitude, radiant altitude, limiting magnitude after twilight and moonlight, cloud, and the dawn-weighted sporadic background.
5. **Finds your best watch window at each site**, then the **Pareto frontier** of meteors against driving time.
6. **Picks your point on the frontier** from one number: how many meteors an hour of driving is worth to you.
7. **Gives you a plan**: leave, lights off, stop, home. Where to face. Real parking lots, viewpoints and campgrounds within 4 km from OpenStreetMap. A copy-ready plan for the group chat.
8. **Shows the next 12 months**: every major shower, its best hour from your darkest reachable site, and how much moon is in the way.
9. **Plays the night before you go**: an all-sky time-lapse of your site. Meteors fire at the model's rate from the real radiant, coloured by speed, with trains on the fast bright ones, through the forecast cloud, under the light domes of the towns around you.
10. **Learns your eyes**: enter what it predicted and what you counted, and every later number scales by your ratio.

## Run it

**Web / phone app**: open `web/index.html` from any static host. GitHub Pages deploys it automatically from this repo (Settings → Pages → Source: GitHub Actions). On a phone, *Add to Home Screen* installs it. The model, city lights and land mask are cached and work with no signal; forecasts, roads and parking need a connection.

**Locally:**
```bash
cd web && python3 -m http.server 8000   # then open http://localhost:8000
```

**Terminal** (clear-sky model, estimated drive times):
```bash
node cli.js --lat 34.07 --lon -118.44 --date 2026-12-13 --max 150 --watch 3 --cloud 10
```

## The model

For each 10-minute step *t* at site *s*:

```
N(s,t) = Σ_showers ZHR(λ⊙) · sin(h_radiant) · r^(LM−6.5) · T_cloud · k
       + HR_sporadic(t) · 3.0^(LM−6.5) · T_cloud · k

ZHR(λ⊙) = ZHR_max · 10^(−B·|λ⊙ − λ_max|)            (asymmetric B for Perseids, Geminids)
LM      = NELM(SQM) + elevation bonus − twilight − moonlight
SQM     = 21.9 − 2.5·log10(1 + 0.003 · Σ_cities P·d^−2.5)   (Walker's law ×0.3, d in km, within 400 km)
T_cloud = (1 − low)(1 − mid)(1 − 0.5·high)              (thin cirrus dims, low and mid block)
k       = your personal calibration (default 1)
```

| Piece | Source | Check |
|---|---|---|
| Sun, Moon, radiants | Meeus low-precision series, J2000 radiants precessed to date, topocentric Moon | Within 0.07° of astropy at 5 sites (`tests/check_ephemeris.py`) |
| Shower catalog | 14 showers after the IMO working list: peak λ⊙, ZHR, r, speed, activity slope, radiant drift | Peak dates match the IMO 2026 calendar |
| Sky darkness | Walker's law over GeoNames cities ≥15k, coefficient fitted to measured SQM at Westwood, Circle X, Mount Pinos, Red Rock Canyon and Joshua Tree | 0.09 mag rms |
| Weather | Open-Meteo hourly cloud layers, temperature, apparent temperature, wind | Live |
| Roads | OSRM table service (drive times, snapping) | Live |
| Parking | OpenStreetMap via Overpass: parking, viewpoints, campgrounds, picnic and rest areas | Live |

**Back-test**: on 17 Nov 2026 the model predicts about 12 meteors for a 2:30–4:00 AM watch at Circle X under 25% cloud. The observed count was 6 bright meteors plus fainter ones. (`tests/leonids2026.test.js`)

## Limits

- Counts are ±40%. ZHR assumes a perfect observer; most people see half to two-thirds. Use the calibration.
- Walker's law is fitted in Southern California. Lighting per person varies by country; skies in places with less outdoor lighting will be darker than shown.
- It can't know about locked gates, lit lots, icy roads, private land, or outbursts outside the catalog. Check the sky and the signs before you go.
- The public OSRM and Overpass servers are shared and rate-limited. For heavy use, point the app at your own.

## Layout

```
web/            the app (static; deploys as-is)
  index.html    page and styles
  app.js        UI, live data, map, frontier, plan
  model.js      the model: pure functions, browser + Node
  cities.json   33,961 cities: lat, lon, population, name, time zone
  land.json     global land mask, 0.05°, run-length encoded
  sw.js, manifest.webmanifest, icon.svg   installable offline app
cli.js          terminal version
tests/          ephemeris check against astropy, Leonids back-test
```

## Data credits

GeoNames (CC BY 4.0), GLOBE land mask via `global-land-mask`, Open-Meteo (CC BY 4.0), OSRM, OpenStreetMap contributors (ODbL). Shower parameters after the International Meteor Organization.

MIT License.
