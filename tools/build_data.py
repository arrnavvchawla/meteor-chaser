"""Rebuild web/cities.json and web/land.json.
pip install geonamescache global-land-mask numpy"""
import json, numpy as np, geonamescache
from global_land_mask import globe
c = geonamescache.GeonamesCache().get_cities().values()
rows = sorted(([round(x['latitude'], 2), round(x['longitude'], 2), round(x['population'] / 1000, 1), x['name'], x['timezone'], x['countrycode']]
               for x in c if x['population'] >= 15000), key=lambda r: -r[2])
tz = sorted({r[4] for r in rows}); ti = {t: i for i, t in enumerate(tz)}
out = [[r[0], r[1], r[2]] + ([r[3] + ', ' + r[5], ti[r[4]]] if r[2] >= 40 else []) for r in rows]
json.dump({'tz': tz, 'c': out}, open('web/cities.json', 'w'), separators=(',', ':'), ensure_ascii=False)
res = 0.05
LA, LO = np.meshgrid(np.arange(90 - res / 2, -90, -res), np.arange(-180 + res / 2, 180, res), indexing='ij')
mask, rle = globe.is_land(LA, LO), []
for r in mask:
    b = np.concatenate([[0], np.flatnonzero(np.diff(r.astype(np.int8))) + 1, [len(r)]]); runs = np.diff(b).tolist()
    rle.append(([0] if r[0] else []) + runs)
json.dump({'res': res, 'rows': rle}, open('web/land.json', 'w'), separators=(',', ':'))
