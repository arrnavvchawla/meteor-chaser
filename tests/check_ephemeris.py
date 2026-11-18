"""Validate the JS ephemeris against astropy. Run: python3 tests/check_ephemeris.py"""
import json, subprocess, warnings, sys
warnings.filterwarnings('ignore')
from astropy.time import Time
from astropy.coordinates import EarthLocation, AltAz, get_sun, get_body, SkyCoord
import astropy.units as u
from astropy.utils import iers
iers.conf.auto_download = False
cases = [("2026-11-18T12:00:00Z", 34.112, -118.931), ("2026-08-12T09:00:00Z", 51.5, -0.1),
         ("2026-12-14T20:00:00Z", -33.9, 151.2), ("2027-01-04T03:00:00Z", 64.1, -21.9), ("2026-05-06T22:00:00Z", -23.5, -70.4)]
js = """const M=require('./web/model.js');const c=%s;console.log(JSON.stringify(c.map(([t,la,lo])=>{const J=M.jd(new Date(t));
const s=M.sun(J),m=M.moon(J);return {sun:M.altaz(s.ra,s.dec,la,lo,J),moon:(a=>({alt:M.moonTopo(a.alt)}))(M.altaz(m.ra,m.dec,la,lo,J)),illum:m.illum,lam:s.lambda2000,
leo:(p=>M.altaz(p.ra,p.dec,la,lo,J))(M.precess(152,22,J))}})))""" % json.dumps(cases)
res = json.loads(subprocess.check_output(['node', '-e', js]))
worst = 0
for (t, la, lo), r in zip(cases, res):
    T = Time(t); loc = EarthLocation(lat=la*u.deg, lon=lo*u.deg); fr = AltAz(obstime=T, location=loc)
    sa = get_sun(T).transform_to(fr); ma = get_body('moon', T, loc).transform_to(fr)
    la_ = SkyCoord(ra=152*u.deg, dec=22*u.deg).transform_to(fr)
    errs = [abs(r['sun']['alt']-sa.alt.deg), abs(r['moon']['alt']-ma.alt.deg), abs(r['leo']['alt']-la_.alt.deg)]
    worst = max(worst, *errs)
    print(f"{t} ({la},{lo}) sun Δ{errs[0]:.2f}° moon Δ{errs[1]:.2f}° radiant Δ{errs[2]:.2f}° λ⊙={r['lam']:.2f} illum={r['illum']:.2f}")
print("worst error %.2f°" % worst); sys.exit(0 if worst < 1.0 else 1)
