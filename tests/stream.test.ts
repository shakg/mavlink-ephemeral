import { execFile } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { LinkConfig } from '../src/shared/types'
import { DialectStore } from '../src/main/dialects'
import { Link } from '../src/main/link'
import { Streamer } from '../src/main/streamer'
import { DEFS } from './helpers'

const dataDir = mkdtempSync(join(tmpdir(), 'me-test-'))
const store = new DialectStore(dataDir, DEFS, () => undefined)
store.init()
afterAll(() => store.dispose())

const base: LinkConfig = {
  protocol: 'udp',
  host: '127.0.0.1',
  port: 0,
  localPort: 0,
  systemId: 7,
  componentId: 1,
  mavlinkVersion: 2,
  heartbeat: { enabled: true, rateHz: 5, type: 2, autopilot: 3, baseMode: 81, customMode: 0, systemStatus: 4 }
}

function listen(args: string[]): Promise<{ counts: Record<string, number>; samples: Record<string, Record<string, unknown>[]>; bad: number }> {
  return new Promise((res, rej) => {
    execFile('python3', [resolve(__dirname, '../scripts/listen.py'), ...args], (err, stdout, stderr) => {
      if (err) rej(new Error(stderr || err.message))
      else res(JSON.parse(stdout))
    })
  })
}

describe('end to end with pymavlink', () => {
  test('user dialect with a custom message streams over UDP', async () => {
    // A user copy of common.xml with a new message added, imported from its own folder.
    const dir = mkdtempSync(join(tmpdir(), 'me-user-'))
    const custom = readFileSync(join(DEFS, 'common.xml'), 'utf8').replace(
      '<messages>',
      `<messages>
    <message id="42999" name="MY_TEST_MSG">
      <description>Custom test message</description>
      <field type="int32_t" name="lat" units="degE7">Latitude</field>
      <field type="float" name="speed" units="m/s">Speed</field>
      <field type="char[10]" name="tag">Tag</field>
    </message>`
    )
    writeFileSync(join(dir, 'common.xml'), custom)
    const [summary] = store.importPaths([join(dir, 'common.xml')])
    expect(summary.errors).toEqual([])
    expect(summary.files.map((f) => f.origin)).toEqual(['source', 'bundled', 'bundled'])
    // pymavlink needs the includes next to the file
    for (const f of ['standard.xml', 'minimal.xml']) copyFileSync(join(DEFS, f), join(dir, f))

    const port = 20000 + Math.floor(Math.random() * 20000)
    const listener = listen(['udpin:127.0.0.1:' + port, join(dir, 'common.xml'), '1.5'])
    await new Promise((r) => setTimeout(r, 700))

    const link = new Link()
    const streamer = new Streamer(store, link)
    await link.open({ ...base, port })
    streamer.configureHeartbeat(summary.id, base.heartbeat)
    streamer.start({
      dialectId: summary.id,
      messageName: 'MY_TEST_MSG',
      rateHz: 50,
      fields: {
        lat: { kind: 'uniform', min: 47.39, max: 47.4, scale: 1e7 },
        speed: { kind: 'sine', min: 0, max: 20, period: 1 },
        tag: { kind: 'constant', value: 'n{n}' }
      }
    })
    const out = await listener
    streamer.dispose()
    link.close()

    expect(out.bad).toBe(0)
    expect(out.counts.HEARTBEAT).toBeGreaterThanOrEqual(3)
    expect(out.counts.MY_TEST_MSG).toBeGreaterThan(40)
    for (const s of out.samples.MY_TEST_MSG) {
      expect(s.lat as number).toBeGreaterThanOrEqual(473900000)
      expect(s.lat as number).toBeLessThanOrEqual(474000000)
      expect(String(s.tag)).toMatch(/^n\d+$/)
    }
    expect(out.samples.HEARTBEAT[0]).toMatchObject({ type: 2, autopilot: 3, mavlink_version: 3 })
  })

  test('TCP server delivers to a connecting GCS', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000)
    const link = new Link()
    const streamer = new Streamer(store, link)
    await link.open({ ...base, protocol: 'tcp-server', host: '127.0.0.1', port })
    streamer.configureHeartbeat('builtin:common.xml', base.heartbeat)
    streamer.start({ dialectId: 'builtin:common.xml', messageName: 'ATTITUDE', rateHz: 20, fields: { roll: { kind: 'ramp', min: -1, max: 1, period: 2 } } })
    const out = await listen(['tcp:127.0.0.1:' + port, join(DEFS, 'common.xml'), '1.2'])
    streamer.dispose()
    link.close()
    expect(out.bad).toBe(0)
    expect(out.counts.ATTITUDE).toBeGreaterThan(10)
    expect(out.counts.HEARTBEAT).toBeGreaterThan(2)
  })
})
