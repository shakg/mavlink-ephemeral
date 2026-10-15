"""Decode hex MAVLink frames given as argv with pymavlink and print JSON (used by tests)."""
import json, os, sys
os.environ['MAVLINK20'] = '1'
from pymavlink.dialects.v20 import common

mav = common.MAVLink(None)
mav.robust_parsing = False
out = []
for h in sys.argv[1:]:
    msgs = mav.parse_buffer(bytes.fromhex(h)) or []
    for m in msgs:
        d = m.to_dict()
        out.append({k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.items()})
print(json.dumps(out))
