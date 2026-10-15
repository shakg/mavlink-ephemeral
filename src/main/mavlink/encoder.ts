import type { BaseType, MessageDef } from '@shared/types'
import { crcAccumulate, crcAccumulateBuffer } from './crc'
import { TYPE_SIZE } from './parser'

export type ScalarValue = number | bigint
export type FieldValue = ScalarValue | string | ScalarValue[]

const INT_RANGE: Partial<Record<BaseType, [number, number]>> = {
  uint8_t: [0, 0xff],
  int8_t: [-0x80, 0x7f],
  uint16_t: [0, 0xffff],
  int16_t: [-0x8000, 0x7fff],
  uint32_t: [0, 0xffffffff],
  int32_t: [-0x80000000, 0x7fffffff]
}

const U64_MAX = (1n << 64n) - 1n
const I64_MIN = -(1n << 63n)
const I64_MAX = (1n << 63n) - 1n

function toInt(v: ScalarValue, type: BaseType): number {
  const n = typeof v === 'bigint' ? Number(v) : v
  const [lo, hi] = INT_RANGE[type]!
  if (!Number.isFinite(n)) return 0
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function toBigInt(v: ScalarValue, type: BaseType): bigint {
  let b: bigint
  if (typeof v === 'bigint') b = v
  else if (!Number.isFinite(v)) b = 0n
  else b = BigInt(Math.round(v))
  const [lo, hi] = type === 'uint64_t' ? [0n, U64_MAX] : [I64_MIN, I64_MAX]
  return b < lo ? lo : b > hi ? hi : b
}

export function writeScalar(view: DataView, offset: number, type: BaseType, v: ScalarValue): void {
  switch (type) {
    case 'char':
    case 'uint8_t':
      view.setUint8(offset, typeof v === 'number' && type === 'char' ? v & 0xff : toInt(v, 'uint8_t'))
      break
    case 'int8_t':
      view.setInt8(offset, toInt(v, type))
      break
    case 'uint16_t':
      view.setUint16(offset, toInt(v, type), true)
      break
    case 'int16_t':
      view.setInt16(offset, toInt(v, type), true)
      break
    case 'uint32_t':
      view.setUint32(offset, toInt(v, type), true)
      break
    case 'int32_t':
      view.setInt32(offset, toInt(v, type), true)
      break
    case 'uint64_t':
      view.setBigUint64(offset, toBigInt(v, type), true)
      break
    case 'int64_t':
      view.setBigInt64(offset, toBigInt(v, type), true)
      break
    case 'float':
      view.setFloat32(offset, Number(v), true)
      break
    case 'double':
      view.setFloat64(offset, Number(v), true)
      break
  }
}

/** Serialises field values into a payload of message.maxLength bytes (wire order). */
export function encodePayload(msg: MessageDef, values: Record<string, FieldValue>): Uint8Array {
  const buf = new Uint8Array(msg.maxLength)
  const view = new DataView(buf.buffer)
  for (const f of msg.fields) {
    const v = values[f.name]
    if (v === undefined) continue
    const size = TYPE_SIZE[f.type]
    if (f.type === 'char' && f.arrayLength) {
      const bytes = typeof v === 'string' ? Buffer.from(v, 'utf8') : Uint8Array.from((v as ScalarValue[]).map(Number))
      buf.set(bytes.subarray(0, f.arrayLength), f.offset)
      continue
    }
    if (f.arrayLength) {
      const arr = Array.isArray(v) ? v : [v as ScalarValue]
      for (let i = 0; i < f.arrayLength; i++) {
        const el = arr[i] ?? 0
        writeScalar(view, f.offset + i * size, f.type, typeof el === 'string' ? Number(el) : el)
      }
    } else {
      const s = Array.isArray(v) ? (v[0] ?? 0) : typeof v === 'string' ? (v.charCodeAt(0) || 0) : v
      writeScalar(view, f.offset, f.type, s)
    }
  }
  return buf
}

export interface FrameHeader {
  seq: number
  systemId: number
  componentId: number
}

/** Builds a complete MAVLink v1 or v2 frame. */
export function encodeFrame(msg: MessageDef, payload: Uint8Array, header: FrameHeader, version: 1 | 2): Uint8Array {
  if (version === 1) {
    if (msg.id > 255) throw new Error(`${msg.name} (id ${msg.id}) cannot be sent over MAVLink 1`)
    const len = msg.baseLength
    const frame = new Uint8Array(6 + len + 2)
    frame.set([0xfe, len, header.seq & 0xff, header.systemId & 0xff, header.componentId & 0xff, msg.id], 0)
    frame.set(payload.subarray(0, len), 6)
    let crc = crcAccumulateBuffer(frame.subarray(1, 6 + len))
    crc = crcAccumulate(msg.crcExtra, crc)
    frame[6 + len] = crc & 0xff
    frame[7 + len] = crc >> 8
    return frame
  }
  // MAVLink 2: trailing zero bytes are truncated (at least one byte is kept).
  let len = payload.length
  while (len > 1 && payload[len - 1] === 0) len--
  const frame = new Uint8Array(10 + len + 2)
  frame.set(
    [
      0xfd,
      len,
      0, // incompat flags
      0, // compat flags
      header.seq & 0xff,
      header.systemId & 0xff,
      header.componentId & 0xff,
      msg.id & 0xff,
      (msg.id >> 8) & 0xff,
      (msg.id >> 16) & 0xff
    ],
    0
  )
  frame.set(payload.subarray(0, len), 10)
  let crc = crcAccumulateBuffer(frame.subarray(1, 10 + len))
  crc = crcAccumulate(msg.crcExtra, crc)
  frame[10 + len] = crc & 0xff
  frame[11 + len] = crc >> 8
  return frame
}

export function toHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
