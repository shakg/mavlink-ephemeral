import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { DialectStore } from '../src/main/dialects'
import { DEFS } from './helpers'

test('editing an imported XML reloads it automatically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'me-watch-'))
  const file = join(dir, 'common.xml')
  const original = readFileSync(join(DEFS, 'common.xml'), 'utf8')
  writeFileSync(file, original)
  const changed: string[] = []
  const store = new DialectStore(mkdtempSync(join(tmpdir(), 'me-data-')), DEFS, (id) => changed.push(id))
  store.init()
  const [d] = store.importPaths([file])
  expect(store.get(d.id)!.messages.some((m) => m.name === 'NEW_ONE')).toBe(false)

  writeFileSync(
    file,
    original.replace('<messages>', '<messages><message id="43000" name="NEW_ONE"><description>x</description><field type="uint8_t" name="a">a</field></message>')
  )
  await new Promise((r) => setTimeout(r, 1000))
  expect(changed).toContain(d.id)
  expect(store.get(d.id)!.messages.some((m) => m.name === 'NEW_ONE')).toBe(true)

  // A broken edit keeps the last good messages and reports the error
  writeFileSync(file, '<mavlink><messages><broken')
  await new Promise((r) => setTimeout(r, 1000))
  expect(store.get(d.id)!.messages.some((m) => m.name === 'NEW_ONE')).toBe(true)
  expect(store.get(d.id)!.errors.length).toBeGreaterThan(0)
  store.dispose()
})
