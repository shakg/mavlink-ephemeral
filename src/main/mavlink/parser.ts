import { XMLParser } from 'fast-xml-parser'
import type { BaseType, EnumDef, FieldDef, MessageDef } from '@shared/types'
import { crcAccumulate, crcAccumulateString, CRC_INIT } from './crc'

export const TYPE_SIZE: Record<BaseType, number> = {
  char: 1,
  uint8_t: 1,
  int8_t: 1,
  uint16_t: 2,
  int16_t: 2,
  uint32_t: 4,
  int32_t: 4,
  uint64_t: 8,
  int64_t: 8,
  float: 4,
  double: 8
}

export interface ResolvedFile {
  name: string
  path: string
  content: string
  origin: 'source' | 'bundled' | 'cache'
}

/** Finds an included file by name. `fromPath` is the path of the including file. */
export type IncludeResolver = (name: string, fromPath: string) => ResolvedFile | null

export interface ParseOutput {
  version?: number
  messages: MessageDef[]
  enums: Record<string, EnumDef>
  files: ResolvedFile[]
  errors: string[]
  warnings: string[]
}

type Node = Record<string, unknown>

const xml = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  // Descriptions sometimes contain inline markup, keep it as text.
  stopNodes: ['*.description']
})

function tagOf(node: Node): string | undefined {
  return Object.keys(node).find((k) => k !== ':@')
}

function children(node: Node): Node[] {
  const tag = tagOf(node)
  return tag ? ((node[tag] as Node[]) ?? []) : []
}

function attrs(node: Node): Record<string, string> {
  return (node[':@'] as Record<string, string>) ?? {}
}

function textOf(node: Node): string {
  return children(node)
    .map((c) => (c['#text'] !== undefined ? String(c['#text']) : textOf(c)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function childrenByTag(node: Node, tag: string): Node[] {
  return children(node).filter((c) => tagOf(c) === tag)
}

function parseIntLoose(v: string): number {
  const s = v.trim()
  if (/^0x/i.test(s)) return parseInt(s, 16)
  if (/^0b/i.test(s)) return parseInt(s.slice(2), 2)
  // Some dialects write enum values as powers, e.g. "2**3"
  const pow = s.match(/^(\d+)\s*\*\*\s*(\d+)$/)
  if (pow) return Math.pow(Number(pow[1]), Number(pow[2]))
  return Number(s)
}

export function parseFieldType(raw: string): { type: BaseType; arrayLength: number; isMavlinkVersion: boolean } | null {
  const m = raw.trim().match(/^([a-z0-9_]+)(?:\[(\d+)\])?$/)
  if (!m) return null
  let base = m[1]
  let isMavlinkVersion = false
  if (base === 'uint8_t_mavlink_version') {
    base = 'uint8_t'
    isMavlinkVersion = true
  }
  if (base === 'array') return null
  if (!(base in TYPE_SIZE)) return null
  return { type: base as BaseType, arrayLength: m[2] ? Number(m[2]) : 0, isMavlinkVersion }
}

interface RawMessage {
  id: number
  name: string
  description: string
  fields: Omit<FieldDef, 'offset'>[]
  deprecated: boolean
  wip: boolean
  file: string
}

/** Computes wire order, offsets, lengths and CRC_EXTRA for a message (MAVLink spec). */
export function finalizeMessage(raw: RawMessage): MessageDef {
  const base = raw.fields.filter((f) => !f.isExtension)
  const ext = raw.fields.filter((f) => f.isExtension)
  // Stable sort by element size, largest first. Extensions keep declaration order.
  const sorted = base
    .map((f, i) => ({ f, i }))
    .sort((a, b) => TYPE_SIZE[b.f.type] - TYPE_SIZE[a.f.type] || a.i - b.i)
    .map((x) => x.f)

  let crc = crcAccumulateString(raw.name + ' ', CRC_INIT)
  for (const f of sorted) {
    crc = crcAccumulateString(f.type + ' ', crc)
    crc = crcAccumulateString(f.name + ' ', crc)
    if (f.arrayLength) crc = crcAccumulate(f.arrayLength & 0xff, crc)
  }
  const crcExtra = (crc & 0xff) ^ (crc >> 8)

  const offsets = new Map<string, number>()
  let offset = 0
  let baseLength = 0
  for (const f of [...sorted, ...ext]) {
    offsets.set(f.name, offset)
    offset += TYPE_SIZE[f.type] * Math.max(1, f.arrayLength)
    if (!f.isExtension) baseLength = offset
  }

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    fields: raw.fields.map((f) => ({ ...f, offset: offsets.get(f.name)! })),
    crcExtra,
    baseLength,
    maxLength: offset,
    deprecated: raw.deprecated || undefined,
    wip: raw.wip || undefined,
    file: raw.file
  }
}

/**
 * Parses a root MAVLink XML definition and all of its includes.
 * Messages and enums from included files are merged (enum entries are merged across files).
 */
export function parseDefinitions(root: ResolvedFile, resolve: IncludeResolver): ParseOutput {
  const out: ParseOutput = { messages: [], enums: {}, files: [], errors: [], warnings: [] }
  const rawMessages: RawMessage[] = []
  const visited = new Set<string>()

  const visit = (file: ResolvedFile, isRoot: boolean): void => {
    if (visited.has(file.name)) return
    visited.add(file.name)
    out.files.push(file)

    let doc: Node[]
    try {
      doc = xml.parse(file.content) as Node[]
    } catch (e) {
      out.errors.push(`${file.name}: XML parse error: ${(e as Error).message}`)
      return
    }
    const mavlink = doc.find((n) => tagOf(n) === 'mavlink')
    if (!mavlink) {
      out.errors.push(`${file.name}: missing <mavlink> root element`)
      return
    }

    for (const inc of childrenByTag(mavlink, 'include')) {
      const name = textOf(inc)
      const resolved = resolve(name, file.path)
      if (!resolved) {
        out.errors.push(`${file.name}: included file "${name}" not found. Import it alongside ${file.name}.`)
        continue
      }
      visit(resolved, false)
    }

    const versionNode = childrenByTag(mavlink, 'version')[0]
    if (versionNode && (isRoot || out.version === undefined)) out.version = Number(textOf(versionNode))

    for (const enumsNode of childrenByTag(mavlink, 'enums')) {
      for (const en of childrenByTag(enumsNode, 'enum')) {
        const a = attrs(en)
        const name = a.name
        if (!name) continue
        const def: EnumDef = (out.enums[name] ??= {
          name,
          bitmask: a.bitmask === 'true',
          description: '',
          entries: []
        })
        if (a.bitmask === 'true') def.bitmask = true
        const desc = childrenByTag(en, 'description')[0]
        if (desc && !def.description) def.description = textOf(desc)
        let next = def.entries.length ? Math.max(...def.entries.map((e) => e.value)) + 1 : 0
        for (const entry of childrenByTag(en, 'entry')) {
          const ea = attrs(entry)
          const value = ea.value !== undefined ? parseIntLoose(ea.value) : next
          next = value + 1
          if (def.entries.some((e) => e.name === ea.name)) continue
          const d = childrenByTag(entry, 'description')[0]
          def.entries.push({ name: ea.name, value, description: d ? textOf(d) : '' })
        }
      }
    }

    for (const msgsNode of childrenByTag(mavlink, 'messages')) {
      for (const m of childrenByTag(msgsNode, 'message')) {
        const a = attrs(m)
        const id = Number(a.id)
        if (!a.name || !Number.isInteger(id)) {
          out.errors.push(`${file.name}: message with invalid name/id (${a.name ?? '?'} / ${a.id ?? '?'})`)
          continue
        }
        const raw: RawMessage = {
          id,
          name: a.name,
          description: '',
          fields: [],
          deprecated: false,
          wip: false,
          file: file.name
        }
        let inExtensions = false
        let ok = true
        for (const c of children(m)) {
          const tag = tagOf(c)
          if (tag === 'description') raw.description = textOf(c)
          else if (tag === 'deprecated') raw.deprecated = true
          else if (tag === 'wip') raw.wip = true
          else if (tag === 'extensions') inExtensions = true
          else if (tag === 'field') {
            const fa = attrs(c)
            const t = parseFieldType(fa.type ?? '')
            if (!t || !fa.name) {
              out.errors.push(`${file.name}: ${raw.name}.${fa.name ?? '?'} has unsupported type "${fa.type}"`)
              ok = false
              continue
            }
            if (raw.fields.some((f) => f.name === fa.name)) {
              out.errors.push(`${file.name}: ${raw.name} has duplicate field "${fa.name}"`)
              ok = false
              continue
            }
            raw.fields.push({
              name: fa.name,
              type: t.type,
              rawType: fa.type,
              arrayLength: t.arrayLength,
              enum: fa.enum || undefined,
              units: fa.units || undefined,
              display: fa.display || undefined,
              invalid: fa.invalid || undefined,
              description: textOf(c),
              isExtension: inExtensions,
              isMavlinkVersion: t.isMavlinkVersion || undefined
            })
          }
        }
        if (!ok) continue
        rawMessages.push(raw)
      }
    }
  }

  visit(root, true)

  const byId = new Map<number, RawMessage>()
  const byName = new Map<string, RawMessage>()
  for (const raw of rawMessages) {
    const dupId = byId.get(raw.id)
    if (dupId) {
      out.errors.push(
        `Message id ${raw.id} is used by both ${dupId.name} (${dupId.file}) and ${raw.name} (${raw.file}); keeping ${dupId.name}`
      )
      continue
    }
    const dupName = byName.get(raw.name)
    if (dupName) {
      out.errors.push(`Message name ${raw.name} defined in both ${dupName.file} and ${raw.file}; keeping the first`)
      continue
    }
    const payload = raw.fields.reduce((n, f) => n + TYPE_SIZE[f.type] * Math.max(1, f.arrayLength), 0)
    if (payload > 255) {
      out.errors.push(`${raw.file}: ${raw.name} payload is ${payload} bytes (max 255)`)
      continue
    }
    if (raw.id > 0xffffff) {
      out.errors.push(`${raw.file}: ${raw.name} id ${raw.id} exceeds 24 bits`)
      continue
    }
    for (const f of raw.fields) {
      if (f.enum && !out.enums[f.enum]) out.warnings.push(`${raw.name}.${f.name} references unknown enum ${f.enum}`)
    }
    byId.set(raw.id, raw)
    byName.set(raw.name, raw)
    out.messages.push(finalizeMessage(raw))
  }
  out.messages.sort((a, b) => a.id - b.id)
  return out
}
