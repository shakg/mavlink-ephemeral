"""Listen on a pymavlink connection for N seconds using a dialect generated from the given XML (used by tests).

usage: listen.py <connection> <dialect.xml> <seconds>
Prints JSON {counts, samples, bad}. CRC errors count as bad.
"""
import json, os, sys, tempfile, time, importlib.util
os.environ['MAVLINK20'] = '1'
from pymavlink import mavutil
from pymavlink.generator import mavgen

conn, xml, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
out_dir = tempfile.mkdtemp()
opts = mavgen.Opts(os.path.join(out_dir, 'dialect'), wire_protocol='2.0', language='Python3', validate=False)
import contextlib
with contextlib.redirect_stdout(sys.stderr):
    mavgen.mavgen(opts, [xml])
spec = importlib.util.spec_from_file_location('dialect', os.path.join(out_dir, 'dialect.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

m = mavutil.mavlink_connection(conn, dialect='common', source_system=255)
m.mav = mod.MAVLink(m, srcSystem=255)
m.mav.robust_parsing = True
counts, samples, bad = {}, {}, 0
end = time.time() + secs
last_hb = 0
while time.time() < end:
    if time.time() - last_hb > 0.5:
        try:
            m.mav.heartbeat_send(6, 8, 0, 0, 0)
        except Exception:
            pass
        last_hb = time.time()
    msg = m.recv_match(blocking=True, timeout=0.1)
    if msg is None:
        continue
    t = msg.get_type()
    if t == 'BAD_DATA':
        bad += 1
        continue
    counts[t] = counts.get(t, 0) + 1
    if len(samples.setdefault(t, [])) < 5:
        d = msg.to_dict()
        samples[t].append({k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.items()})
print(json.dumps({'counts': counts, 'samples': samples, 'bad': bad}))
