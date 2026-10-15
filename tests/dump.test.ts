import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { loadBundled } from './helpers'

// Writes our view of every message so scripts/compare_pymavlink.py can diff against pymavlink.
test.skipIf(!process.env.DUMP)('dump', () => {
  const out: Record<string, unknown> = {}
  for (const d of ['ardupilotmega.xml', 'development.xml', 'test.xml', 'storm32.xml', 'ASLUAV.xml', 'AVSSUAS.xml', 'paparazzi.xml']) {
    const r = loadBundled(d)
    for (const m of r.messages) out[m.name] = [m.id, m.crcExtra, m.baseLength, m.maxLength, r.errors.length]
  }
  writeFileSync(process.env.DUMP!, JSON.stringify(out))
})
