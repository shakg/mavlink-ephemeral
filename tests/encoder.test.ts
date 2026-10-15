import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { encodeFrame, encodePayload, toHex } from '../src/main/mavlink/encoder'
import { MessageValueSource } from '../src/main/mavlink/generators'
import { loadBundled } from './helpers'

const common = loadBundled('common.xml')
const msg = (name: string) => common.messages.find((m) => m.name === name)!

function hasPymavlink(): boolean {
  try {
    execFileSync('python3', ['-c', 'import pymavlink'])
    return true
  } catch {
    return false
  }
}

describe('parser', () => {
  test('common.xml resolves includes without errors', () => {
    expect(common.errors).toEqual([])
    expect(common.files.map((f) => f.name)).toEqual(['common.xml', 'standard.xml', 'minimal.xml'])
    expect(msg('HEARTBEAT').crcExtra).toBe(50)
    expect(msg('GLOBAL_POSITION_INT').crcExtra).toBe(104)
  })

  test('reports missing includes and duplicate ids', async () => {
    const { parseDefinitions } = await import('../src/main/mavlink/parser')
    const xml = `<mavlink><include>nope.xml</include><messages>
      <message id="1" name="A"><field type="uint8_t" name="x">x</field></message>
      <message id="1" name="B"><field type="uint8_t" name="y">y</field></message></messages></mavlink>`
    const r = parseDefinitions({ name: 'a.xml', path: '/a.xml', content: xml, origin: 'source' }, () => null)
    expect(r.errors.some((e) => e.includes('nope.xml'))).toBe(true)
    expect(r.errors.some((e) => e.includes('id 1'))).toBe(true)
    expect(r.messages).toHaveLength(1)
  })
})

describe.skipIf(!hasPymavlink())('frames decode with pymavlink', () => {
  test('v1 and v2 frames', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['HEARTBEAT', { type: 2, autopilot: 3, base_mode: 81, custom_mode: 65536, system_status: 4 }],
      ['GLOBAL_POSITION_INT', { time_boot_ms: 1234, lat: 473977418, lon: 85455940, alt: 488000, relative_alt: -5, vx: -100, vy: 3, vz: 0, hdg: 35999 }],
      ['GPS_RAW_INT', { time_usec: 1700000000000000n, fix_type: 3, lat: -1, lon: 2, alt: 3, eph: 4, epv: 5, vel: 6, cog: 7, satellites_visible: 12, alt_ellipsoid: 99, h_acc: 1, yaw: 9000 }],
      ['STATUSTEXT', { severity: 6, text: 'hello gcs', id: 7, chunk_seq: 0 }],
      ['ATTITUDE', { time_boot_ms: 5, roll: 0.5, pitch: -0.25, yaw: 3.14, rollspeed: 0, pitchspeed: 0, yawspeed: 1e-3 }],
      ['SERVO_OUTPUT_RAW', { time_usec: 9, port: 1, servo1_raw: 1500, servo16_raw: 2000 }],
      ['PARAM_VALUE', { param_id: 'SYSID_THISMAV', param_value: 1, param_type: 9, param_count: 100, param_index: 3 }]
    ]
    const frames: string[] = []
    for (const version of [1, 2] as const) {
      cases.forEach(([name, values], i) => {
        const m = msg(name)
        const payload = encodePayload(m, { ...values, mavlink_version: 3 } as never)
        frames.push(toHex(encodeFrame(m, payload, { seq: i, systemId: 1, componentId: 1 }, version)).replace(/ /g, ''))
      })
    }
    const script = resolve(__dirname, '../scripts/decode_frames.py')
    const out = JSON.parse(execFileSync('python3', [script, ...frames]).toString()) as Record<string, unknown>[]
    expect(out).toHaveLength(frames.length)
    const v2 = out.slice(cases.length)
    expect(v2[0]).toMatchObject({ mavpackettype: 'HEARTBEAT', type: 2, custom_mode: 65536, mavlink_version: 3 })
    expect(v2[1]).toMatchObject({ lat: 473977418, lon: 85455940, relative_alt: -5, vx: -100, hdg: 35999 })
    expect(v2[2]).toMatchObject({ time_usec: 1700000000000000, satellites_visible: 12, alt_ellipsoid: 99, yaw: 9000 })
    expect(v2[3]).toMatchObject({ text: 'hello gcs', id: 7 })
    expect(v2[4]).toMatchObject({ roll: 0.5, pitch: -0.25 })
    expect(v2[5]).toMatchObject({ servo1_raw: 1500, servo16_raw: 2000 })
    expect(v2[6]).toMatchObject({ param_id: 'SYSID_THISMAV', param_count: 100 })
    expect(out[1]).toMatchObject({ lat: 473977418 })
  })
})

describe('generators', () => {
  test('ranges, timestamps, scale and arrays', () => {
    const src = new MessageValueSource(
      msg('GLOBAL_POSITION_INT'),
      {
        lat: { kind: 'uniform', min: 47.39, max: 47.4, scale: 1e7 },
        lon: { kind: 'sine', min: 8.5, max: 8.6, period: 4, scale: 1e7 },
        time_boot_ms: { kind: 'timestamp', timestampUnit: 'boot_ms' },
        hdg: { kind: 'counter', start: 0, step: 100, max: 300 },
        alt: { kind: 'randomWalk', min: 0, max: 10, step: 5 }
      },
      3,
      1000
    )
    const hdgs: unknown[] = []
    for (let i = 0; i < 6; i++) {
      const v = src.next(1000 + i * 250)
      expect(v.lat as number).toBeGreaterThanOrEqual(473900000)
      expect(v.lat as number).toBeLessThanOrEqual(474000000)
      expect(Number.isInteger(v.lat)).toBe(true)
      expect(v.time_boot_ms).toBe(i * 250)
      expect(v.alt as number).toBeGreaterThanOrEqual(0)
      expect(v.alt as number).toBeLessThanOrEqual(10)
      hdgs.push(v.hdg)
    }
    expect(hdgs).toEqual([0, 100, 200, 300, 0, 100])

    const servo = new MessageValueSource(msg('ACTUATOR_OUTPUT_STATUS'), { actuator: { kind: 'constant', value: '0.5' } }, 3)
    expect(servo.next().actuator).toEqual(new Array(32).fill(0.5))
  })
})
