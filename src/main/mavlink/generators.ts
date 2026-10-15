import type { FieldDef, FieldGenerator, MessageDef } from '@shared/types'
import type { FieldValue, ScalarValue } from './encoder'

const INTEGER_TYPES = new Set(['uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t'])

/** Parses a user-typed scalar: decimals, hex, NaN/inf, booleans, big 64-bit integers. */
export function parseScalar(s: string, field: FieldDef): ScalarValue {
  const t = s.trim()
  if (t === '') return 0
  const lower = t.toLowerCase()
  if (lower === 'nan') return NaN
  if (lower === 'inf' || lower === '+inf' || lower === 'infinity') return Infinity
  if (lower === '-inf' || lower === '-infinity') return -Infinity
  if (lower === 'true') return 1
  if (lower === 'false') return 0
  if (field.type === 'uint64_t' || field.type === 'int64_t') {
    try {
      return BigInt(t)
    } catch {
      /* fall through to Number for e.g. "1.5e3" */
    }
  }
  if (/^-?0x[0-9a-f]+$/i.test(t)) return t.startsWith('-') ? -parseInt(t.slice(1), 16) : parseInt(t, 16)
  const n = Number(t)
  return Number.isNaN(n) ? 0 : n
}

function parseList(s: string | undefined, field: FieldDef): ScalarValue[] {
  if (!s) return []
  return s
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((x) => parseScalar(x, field))
}

interface ElementState {
  walk?: number
  counter?: number
  cycle: number
}

/**
 * Produces a value per tick for one field. Arrays get independent state per element
 * so random generators produce different values in each element.
 */
export class FieldValueSource {
  private states: ElementState[] = []

  constructor(
    private field: FieldDef,
    private gen: FieldGenerator,
    private startTime: number,
    private mavlinkVersion: number
  ) {}

  next(now: number, tick: number): FieldValue {
    const f = this.field
    if (f.isMavlinkVersion) return this.mavlinkVersion
    const g = this.gen
    if (f.type === 'char' && f.arrayLength) {
      // char arrays are strings. "{n}" is replaced with the tick counter so text can change over time.
      const text = g.value ?? ''
      return text.replace(/\{n\}/g, String(tick))
    }
    if (g.kind === 'constant') {
      if (f.arrayLength) {
        const list = parseList(g.value, f)
        // A single value fills the whole array.
        if (list.length === 1) return new Array(f.arrayLength).fill(this.scaled(list[0]))
        return list.map((v) => this.scaled(v))
      }
      return this.scaled(parseScalar(g.value ?? '0', f))
    }
    const count = Math.max(1, f.arrayLength)
    const values: ScalarValue[] = []
    for (let i = 0; i < count; i++) values.push(this.element(i, now, tick))
    return f.arrayLength ? values : values[0]
  }

  private scaled(v: ScalarValue): ScalarValue {
    const scale = this.gen.scale
    if (!scale || scale === 1) return v
    return typeof v === 'bigint' ? BigInt(Math.round(Number(v) * scale)) : v * scale
  }

  private round(v: number): number {
    return INTEGER_TYPES.has(this.field.type) ? Math.round(v) : v
  }

  private element(i: number, now: number, tick: number): ScalarValue {
    const g = this.gen
    const st = (this.states[i] ??= { cycle: 0 })
    const min = g.min ?? 0
    const max = g.max ?? 1
    const t = (now - this.startTime) / 1000
    let v: number
    switch (g.kind) {
      case 'uniform':
        v = min + Math.random() * (max - min)
        break
      case 'sine': {
        const period = g.period && g.period > 0 ? g.period : 10
        const phase = ((g.phase ?? 0) * Math.PI) / 180
        v = min + ((max - min) * (1 + Math.sin((2 * Math.PI * t) / period + phase))) / 2
        break
      }
      case 'ramp': {
        const period = g.period && g.period > 0 ? g.period : 10
        v = min + (max - min) * ((t % period) / period)
        break
      }
      case 'randomWalk': {
        const step = g.step ?? (max - min) / 100
        const prev = st.walk ?? g.start ?? (min + max) / 2
        let nextV = prev + (Math.random() * 2 - 1) * step
        // Bounce off the limits so the walk stays inside [min, max].
        if (nextV > max) nextV = max - (nextV - max)
        if (nextV < min) nextV = min + (min - nextV)
        nextV = Math.min(max, Math.max(min, nextV))
        st.walk = nextV
        v = nextV
        break
      }
      case 'counter': {
        const step = g.step ?? 1
        const start = g.start ?? 0
        let nextV = st.counter === undefined ? start : st.counter + step
        if (g.max !== undefined && g.max !== null && nextV > g.max) nextV = g.min ?? start
        st.counter = nextV
        v = nextV
        break
      }
      case 'timestamp': {
        const unit = g.timestampUnit ?? 'boot_ms'
        const sinceStart = now - this.startTime
        if (unit === 'boot_ms') v = sinceStart
        else if (unit === 'boot_us') return this.u64(BigInt(Math.round(sinceStart * 1000)))
        else if (unit === 'unix_ms') return this.u64(BigInt(Math.round(now)))
        else if (unit === 'unix_us') return this.u64(BigInt(Math.round(now * 1000)))
        else v = Math.floor(now / 1000)
        // timestamps are not scaled
        return Math.round(v)
      }
      case 'choice': {
        const list = parseList(g.choices, this.field)
        if (!list.length) return 0
        if (g.choiceMode === 'cycle') {
          const val = list[st.cycle % list.length]
          st.cycle++
          return val
        }
        return list[Math.floor(Math.random() * list.length)]
      }
      default:
        v = 0
    }
    void tick
    const s = this.scaled(v) as number
    return this.round(s)
  }

  private u64(v: bigint): ScalarValue {
    // 64-bit fields keep full precision, narrower fields get a wrapped number.
    if (this.field.type === 'uint64_t' || this.field.type === 'int64_t') return v
    return Number(v % 4294967296n)
  }
}

export function defaultGenerator(field: FieldDef): FieldGenerator {
  if (field.type === 'char' && field.arrayLength) return { kind: 'constant', value: '' }
  return { kind: 'constant', value: '0' }
}

export class MessageValueSource {
  private sources: { field: FieldDef; src: FieldValueSource }[]
  private tick = 0

  constructor(msg: MessageDef, fields: Record<string, FieldGenerator>, mavlinkVersion: number, startTime = Date.now()) {
    this.sources = msg.fields.map((field) => ({
      field,
      src: new FieldValueSource(field, fields[field.name] ?? defaultGenerator(field), startTime, mavlinkVersion)
    }))
  }

  next(now = Date.now()): Record<string, FieldValue> {
    const out: Record<string, FieldValue> = {}
    for (const { field, src } of this.sources) out[field.name] = src.next(now, this.tick)
    this.tick++
    return out
  }
}

/** JSON-safe copy of generated values for display in the UI. */
export function displayValues(values: Record<string, FieldValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'bigint') out[k] = v.toString()
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'bigint' ? x.toString() : x))
    else if (typeof v === 'number' && !Number.isFinite(v)) out[k] = String(v)
    else out[k] = v
  }
  return out
}
