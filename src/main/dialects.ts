import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Dialect, DialectSummary } from '@shared/types'
import { parseDefinitions, type ResolvedFile } from './mavlink/parser'

interface StoredDialect {
  id: string
  sourcePath: string
  builtin: boolean
}

function summary(d: Dialect): DialectSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { messages, enums, ...rest } = d
  return rest
}

/**
 * Loads MAVLink dialects from user-imported XML files and from the bundled definitions.
 *
 * Imported files are parsed straight from their original location so edits are picked up
 * (the files are watched and re-parsed automatically). A copy is cached in userData so the
 * dialect still loads if the original disappears.
 */
export class DialectStore {
  private dialects = new Map<string, Dialect>()
  private stored: StoredDialect[] = []
  private watchers = new Map<string, FSWatcher[]>()
  private reloadTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private dataDir: string,
    private bundledDir: string,
    private onChanged: (id: string) => void
  ) {
    mkdirSync(this.cacheRoot, { recursive: true })
  }

  private get cacheRoot(): string {
    return join(this.dataDir, 'definitions')
  }

  private get indexPath(): string {
    return join(this.dataDir, 'dialects.json')
  }

  init(): void {
    try {
      this.stored = JSON.parse(readFileSync(this.indexPath, 'utf8'))
    } catch {
      this.stored = []
    }
    for (const file of this.bundledFiles()) {
      const id = `builtin:${file}`
      this.load({ id, sourcePath: join(this.bundledDir, file), builtin: true }, false)
    }
    for (const s of this.stored) this.load(s, true)
  }

  private bundledFiles(): string[] {
    if (!existsSync(this.bundledDir)) return []
    return readdirSync(this.bundledDir)
      .filter((f) => f.endsWith('.xml'))
      .sort((a, b) => {
        const order = ['common.xml', 'ardupilotmega.xml', 'standard.xml', 'minimal.xml', 'development.xml']
        const ia = order.indexOf(a)
        const ib = order.indexOf(b)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
      })
  }

  private save(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.stored, null, 2))
  }

  list(): DialectSummary[] {
    const user = this.stored.map((s) => this.dialects.get(s.id)).filter(Boolean) as Dialect[]
    const builtin = [...this.dialects.values()].filter((d) => d.builtin)
    return [...user, ...builtin].map(summary)
  }

  get(id: string): Dialect | null {
    return this.dialects.get(id) ?? null
  }

  /** Imports one or more XML files. Files included by another imported file are not added as separate dialects. */
  importPaths(paths: string[]): DialectSummary[] {
    const xmlPaths = paths.filter((p) => p.toLowerCase().endsWith('.xml') && existsSync(p))
    const names = new Set(xmlPaths.map((p) => basename(p)))
    const includedByOthers = new Set<string>()
    for (const p of xmlPaths) {
      const content = readFileSync(p, 'utf8')
      for (const m of content.matchAll(/<include>\s*([^<]+?)\s*<\/include>/g)) {
        if (names.has(m[1])) includedByOthers.add(m[1])
      }
    }
    let roots = xmlPaths.filter((p) => !includedByOthers.has(basename(p)))
    if (!roots.length) roots = xmlPaths

    const result: DialectSummary[] = []
    for (const p of roots) {
      const id = 'user:' + createHash('sha1').update(p).digest('hex').slice(0, 12)
      if (!this.stored.some((s) => s.id === id)) this.stored.unshift({ id, sourcePath: p, builtin: false })
      const d = this.load({ id, sourcePath: p, builtin: false }, true)
      if (d) result.push(summary(d))
    }
    this.save()
    return result
  }

  reload(id: string): DialectSummary | null {
    const s = this.stored.find((x) => x.id === id) ?? (id.startsWith('builtin:') ? this.builtinStored(id) : undefined)
    if (!s) return null
    const d = this.load(s, !s.builtin)
    return d ? summary(d) : null
  }

  private builtinStored(id: string): StoredDialect {
    return { id, sourcePath: join(this.bundledDir, id.slice('builtin:'.length)), builtin: true }
  }

  remove(id: string): void {
    this.unwatch(id)
    this.stored = this.stored.filter((s) => s.id !== id)
    this.dialects.delete(id)
    rmSync(join(this.cacheRoot, this.cacheDirName(id)), { recursive: true, force: true })
    this.save()
  }

  private cacheDirName(id: string): string {
    return id.replace(/[^a-z0-9_-]/gi, '_')
  }

  private load(s: StoredDialect, watchSources: boolean): Dialect | null {
    const cacheDir = join(this.cacheRoot, this.cacheDirName(s.id))
    const sourceDir = dirname(s.sourcePath)

    const readFrom = (path: string, origin: ResolvedFile['origin']): ResolvedFile | null => {
      if (!existsSync(path)) return null
      try {
        return { name: basename(path), path, content: readFileSync(path, 'utf8'), origin }
      } catch {
        return null
      }
    }

    // Includes resolve from the folder the user imported from, then the cached copy,
    // and finally the bundled official definitions.
    const resolveFile = (name: string): ResolvedFile | null => {
      if (s.builtin) return readFrom(join(this.bundledDir, name), 'bundled')
      return (
        readFrom(join(sourceDir, name), 'source') ??
        readFrom(join(cacheDir, name), 'cache') ??
        readFrom(join(this.bundledDir, name), 'bundled')
      )
    }

    const root = s.builtin
      ? readFrom(s.sourcePath, 'bundled')
      : (readFrom(s.sourcePath, 'source') ?? readFrom(join(cacheDir, basename(s.sourcePath)), 'cache'))

    const prev = this.dialects.get(s.id)
    if (!root) {
      const missing: Dialect = {
        id: s.id,
        name: basename(s.sourcePath, '.xml'),
        rootFile: basename(s.sourcePath),
        sourcePath: s.sourcePath,
        builtin: s.builtin,
        messageCount: 0,
        enumCount: 0,
        files: [],
        errors: [`File not found: ${s.sourcePath}`],
        warnings: [],
        loadedAt: Date.now(),
        messages: [],
        enums: {}
      }
      this.dialects.set(s.id, missing)
      return missing
    }

    const parsed = parseDefinitions(root, resolveFile)
    const d: Dialect = {
      id: s.id,
      name: basename(s.sourcePath, '.xml'),
      rootFile: basename(s.sourcePath),
      sourcePath: s.sourcePath,
      builtin: s.builtin,
      version: parsed.version,
      messageCount: parsed.messages.length,
      enumCount: Object.keys(parsed.enums).length,
      files: parsed.files.map((f) => ({ name: f.name, path: f.path, origin: f.origin })),
      errors: parsed.errors,
      warnings: parsed.warnings,
      loadedAt: Date.now(),
      messages: parsed.messages,
      enums: parsed.enums
    }
    if (root.origin === 'cache') d.warnings.unshift(`Original file missing, using cached copy of ${s.sourcePath}`)

    // A broken edit should not wipe out a dialect that was working: keep the previous messages.
    if (prev && prev.messages.length && !parsed.messages.length && parsed.errors.length) {
      prev.errors = parsed.errors
      prev.loadedAt = Date.now()
      return prev
    }
    this.dialects.set(s.id, d)

    if (!s.builtin) {
      mkdirSync(cacheDir, { recursive: true })
      for (const f of parsed.files) {
        if (f.origin === 'source') writeFileSync(join(cacheDir, f.name), f.content)
      }
      if (watchSources) this.watch(s, parsed.files.filter((f) => f.origin === 'source').map((f) => f.path))
    }
    return d
  }

  private watch(s: StoredDialect, paths: string[]): void {
    this.unwatch(s.id)
    const ws: FSWatcher[] = []
    for (const p of paths) {
      try {
        ws.push(
          watch(p, () => {
            clearTimeout(this.reloadTimers.get(s.id))
            this.reloadTimers.set(
              s.id,
              setTimeout(() => {
                this.load(s, true)
                this.onChanged(s.id)
              }, 300)
            )
          })
        )
      } catch {
        /* file may be on a filesystem without watch support */
      }
    }
    this.watchers.set(s.id, ws)
  }

  private unwatch(id: string): void {
    for (const w of this.watchers.get(id) ?? []) w.close()
    this.watchers.delete(id)
  }

  dispose(): void {
    for (const id of this.watchers.keys()) this.unwatch(id)
  }
}
