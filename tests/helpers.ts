import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseDefinitions, type ResolvedFile } from '../src/main/mavlink/parser'

export const DEFS = resolve(__dirname, '../resources/definitions')

export function loadBundled(name: string) {
  const file = (n: string): ResolvedFile | null => {
    const p = join(DEFS, n)
    return existsSync(p) ? { name: n, path: p, content: readFileSync(p, 'utf8'), origin: 'bundled' } : null
  }
  return parseDefinitions(file(name)!, (n) => file(n))
}
