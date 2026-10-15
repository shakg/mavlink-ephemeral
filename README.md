# MAVLink Ephemeral

Desktop app (Electron + React + shadcn/ui) for testing a GCS without a vehicle or simulator.
Load your own MAVLink XML definitions, pick a message, fill its fields with constants or synthetic data,
and stream it over UDP or TCP at any rate.

## Run

```bash
npm install
npm run dev        # development with hot reload
npm run dist       # build an installer (AppImage / NSIS / DMG)
npm test           # parser/encoder tests; end-to-end tests run if pymavlink is installed
```

## Workflow

1. Import your XML (button, or drag & drop). Includes like `standard.xml`/`minimal.xml` resolve from the same
   folder first, then fall back to the bundled official definitions in `resources/definitions`.
2. Edit the XML in your editor: the app watches the files and reloads on save, and running streams pick up the new definition.
3. Pick a message, set the rate, and press **Connect & start**. Several messages can stream at once.
4. QGroundControl listens on UDP 14550 by default. For TCP, choose *TCP server* (port 5760) and connect the GCS to it.
   An automatic HEARTBEAT (configurable type/autopilot/mode) makes the GCS show the vehicle.

## Synthetic data (per field)

| Source | Parameters |
| --- | --- |
| Constant | value; arrays take a comma list (one value fills all); `char[]` text supports `{n}` = message counter |
| Random | uniform between min and max |
| Random walk | start, min, max, ±step per message |
| Sine | min, max, period, phase. Lat sine + lon sine with the same period, 90° apart = circular flight |
| Ramp | sawtooth min → max over a period |
| Counter | start, step, wrap |
| Timestamp | ms/µs since start, or Unix time |
| Pick from list | random or cycling values (pre-filled with the enum's values) |

Fields with scaled units (`degE7`, `cdeg`, `mm`, `cm/s`…) have a unit toggle so you can enter degrees/metres;
`degE7` fields default to degrees.

## Layout

- `src/main/mavlink/` XML parser (includes, enums, wire ordering, CRC_EXTRA), frame encoder (v1/v2), value generators
- `src/main/{dialects,link,streamer}.ts` definition store + file watching, UDP/TCP link, rate scheduler
- `src/renderer/` React UI
- `scripts/` pymavlink helpers used by the tests (CRC_EXTRA was cross-checked against pymavlink for all 382 bundled messages)
