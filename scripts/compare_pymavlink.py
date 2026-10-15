"""Compare CRC_EXTRA / lengths computed by the app against pymavlink's mavparse."""
import json, sys, os
from pymavlink.generator import mavparse

defs = sys.argv[1]
ours = json.load(open(sys.argv[2]))
seen = {}
for d in ['ardupilotmega.xml', 'development.xml', 'test.xml', 'storm32.xml', 'ASLUAV.xml', 'AVSSUAS.xml', 'paparazzi.xml']:
    todo = [os.path.join(defs, d)]
    done = set()
    while todo:
        p = todo.pop()
        if p in done: continue
        done.add(p)
        x = mavparse.MAVXML(p, mavparse.PROTOCOL_2_0)
        for m in x.message:
            seen[m.name] = [m.id, m.crc_extra, m.wire_min_length, m.wire_length]
        todo += [os.path.join(defs, i) for i in x.include]
bad = 0
for name, v in seen.items():
    if name not in ours: print('missing', name); bad += 1; continue
    if ours[name][:4] != v: print('DIFF', name, ours[name], v); bad += 1
print(len(seen), 'messages compared,', bad, 'problems')
