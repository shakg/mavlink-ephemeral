import type { EnumDef, FieldDef, FieldGenerator, GeneratorKind } from '@shared/types'

export const GENERATORS: { kind: GeneratorKind; label: string; hint: string }[] = [
  { kind: 'constant', label: 'Constant', hint: 'Fixed value' },
  { kind: 'uniform', label: 'Random', hint: 'Uniform random between min and max every message' },
  { kind: 'randomWalk', label: 'Random walk', hint: 'Drifts by up to ±step per message, bouncing inside [min, max]' },
  { kind: 'sine', label: 'Sine', hint: 'Smooth oscillation. Two sines with the same period and 90° apart draw a circle' },
  { kind: 'ramp', label: 'Ramp', hint: 'Sawtooth from min to max over the period' },
  { kind: 'counter', label: 'Counter', hint: 'Adds step every message, wraps to start after max' },
  { kind: 'timestamp', label: 'Timestamp', hint: 'Time since stream start or wall clock' },
  { kind: 'choice', label: 'Pick from list', hint: 'Random or cycling value from a list' }
]

export const INT_LIMITS: Record<string, [number, number]> = {
  uint8_t: [0, 255],
  int8_t: [-128, 127],
  uint16_t: [0, 65535],
  int16_t: [-32768, 32767],
  uint32_t: [0, 4294967295],
  int32_t: [-2147483648, 2147483647],
  uint64_t: [0, Number.MAX_SAFE_INTEGER],
  int64_t: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  char: [0, 255]
}

/** Raw MAVLink units that are friendlier to enter in a converted unit. */
export const UNIT_CONVERSIONS: Record<string, { label: string; scale: number }> = {
  degE7: { label: 'deg', scale: 1e7 },
  cdeg: { label: 'deg', scale: 100 },
  'cdeg/s': { label: 'deg/s', scale: 100 },
  mm: { label: 'm', scale: 1000 },
  cm: { label: 'm', scale: 100 },
  'cm/s': { label: 'm/s', scale: 100 },
  'mm/s': { label: 'm/s', scale: 1000 },
  mrad: { label: 'rad', scale: 1000 },
  mV: { label: 'V', scale: 1000 },
  cA: { label: 'A', scale: 100 },
  cdegC: { label: '°C', scale: 100 },
  ms: { label: 's', scale: 1000 },
  us: { label: 's', scale: 1e6 }
}

export function isTextField(f: FieldDef): boolean {
  return f.type === 'char' && f.arrayLength > 0
}

export function isIntegerField(f: FieldDef): boolean {
  return f.type !== 'float' && f.type !== 'double'
}

export function defaultGenerator(f: FieldDef): FieldGenerator {
  if (isTextField(f)) return { kind: 'constant', value: '' }
  // Fields with a converted unit default to the friendly unit (e.g. lat/lon in degrees).
  if (f.units === 'degE7') return { kind: 'constant', value: '0', scale: 1e7 }
  return { kind: 'constant', value: '0' }
}

/** Sensible starting parameters when switching a field to a new generator kind. */
export function switchKind(f: FieldDef, prev: FieldGenerator, kind: GeneratorKind, en?: EnumDef): FieldGenerator {
  const scale = prev.scale
  const base = Number(prev.value)
  const center = Number.isFinite(base) ? base : 0
  const [lo, hi] = INT_LIMITS[f.type] ?? [-1000, 1000]
  const span = scale ? Math.max(Math.abs(center) * 0.01, 0.01) : Math.max(1, Math.abs(center) * 0.01 || (isIntegerField(f) ? Math.min(100, hi - lo) : 1))
  const min = Math.max(scale ? lo / scale : lo, center - span)
  const max = Math.min(scale ? hi / scale : hi, center + span)
  switch (kind) {
    case 'constant':
      return { kind, value: prev.value ?? '0', scale }
    case 'uniform':
      return { kind, min, max, scale }
    case 'randomWalk':
      return { kind, min, max, start: center, step: (max - min) / 50, scale }
    case 'sine':
      return { kind, min, max, period: 10, phase: 0, scale }
    case 'ramp':
      return { kind, min, max, period: 10, scale }
    case 'counter':
      return { kind, start: 0, step: 1, max: hi === Number.MAX_SAFE_INTEGER ? undefined : hi, scale: undefined }
    case 'timestamp':
      return {
        kind,
        timestampUnit: f.type.includes('64') ? (f.name.includes('usec') ? 'unix_us' : 'boot_us') : 'boot_ms'
      }
    case 'choice':
      return {
        kind,
        choices: en ? en.entries.map((e) => e.value).join(', ') : '0, 1',
        choiceMode: 'random'
      }
  }
}

/** Formats a generated value for the live column. */
export function formatLive(v: unknown, f: FieldDef, en?: EnumDef, scale?: number): string {
  if (v === undefined || v === null) return '–'
  const conv = f.units ? UNIT_CONVERSIONS[f.units] : undefined
  if (scale && conv && typeof v === 'number') return `${v} · ${Number((v / scale).toFixed(7))} ${conv.label}`
  if (Array.isArray(v)) {
    const shown = v.slice(0, 6).map((x) => formatNumber(x, f))
    return `[${shown.join(', ')}${v.length > 6 ? `, …+${v.length - 6}` : ''}]`
  }
  if (typeof v === 'string' && isTextField(f)) return JSON.stringify(v)
  const s = formatNumber(v, f)
  if (en && !en.bitmask) {
    const e = en.entries.find((x) => String(x.value) === String(v))
    if (e) return `${s} · ${e.name}`
  }
  return s
}

function formatNumber(v: unknown, f: FieldDef): string {
  if (typeof v !== 'number') return String(v)
  if (isIntegerField(f)) return String(v)
  return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(Number(v.toFixed(5)))
}
