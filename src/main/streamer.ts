import type { HeartbeatConfig, MessageDef, StreamSpec, StreamStatus } from '@shared/types'
import type { DialectStore } from './dialects'
import type { Link } from './link'
import { encodeFrame, encodePayload, toHex, type FieldValue } from './mavlink/encoder'
import { displayValues, MessageValueSource } from './mavlink/generators'

const MAX_RATE_HZ = 1000
/** Max frames sent in one timer callback when the event loop fell behind. */
const MAX_BURST = 20

interface Stream {
  id: string
  spec: StreamSpec
  msg: MessageDef
  source: MessageValueSource
  startTime: number
  timer?: NodeJS.Timeout
  nextDue: number
  sent: number
  rateWindow: number[]
  lastValues: Record<string, FieldValue>
  lastFrame: Uint8Array
  error?: string
}

export class Streamer {
  private streams = new Map<string, Stream>()
  private nextId = 1
  private heartbeatTimer?: NodeJS.Timeout
  private heartbeatSource?: { key: string; source: MessageValueSource; msg: MessageDef }

  constructor(
    private dialects: DialectStore,
    private link: Link
  ) {}

  private resolve(spec: StreamSpec): { msg: MessageDef; version: number } {
    const d = this.dialects.get(spec.dialectId)
    if (!d) throw new Error(`Dialect ${spec.dialectId} is not loaded`)
    const msg = d.messages.find((m) => m.name === spec.messageName)
    if (!msg) throw new Error(`${spec.messageName} not found in ${d.name}`)
    return { msg, version: d.version ?? 3 }
  }

  private frameFor(msg: MessageDef, values: Record<string, FieldValue>, spec?: StreamSpec): Uint8Array {
    const cfg = this.link.linkConfig
    const version = cfg?.mavlinkVersion ?? 2
    return encodeFrame(
      msg,
      encodePayload(msg, values),
      {
        seq: this.link.nextSeq(),
        systemId: spec?.systemId ?? cfg?.systemId ?? 1,
        componentId: spec?.componentId ?? cfg?.componentId ?? 1
      },
      version
    )
  }

  /** Builds one frame without sending it (for the live preview in the editor). */
  preview(spec: StreamSpec): { hex: string; values: Record<string, unknown>; error?: string } {
    try {
      const { msg, version } = this.resolve(spec)
      const values = new MessageValueSource(msg, spec.fields, version).next()
      const cfg = this.link.linkConfig
      const frame = encodeFrame(
        msg,
        encodePayload(msg, values),
        { seq: 0, systemId: spec.systemId ?? cfg?.systemId ?? 1, componentId: spec.componentId ?? cfg?.componentId ?? 1 },
        cfg?.mavlinkVersion ?? 2
      )
      return { hex: toHex(frame), values: displayValues(values) }
    } catch (e) {
      return { hex: '', values: {}, error: (e as Error).message }
    }
  }

  sendOnce(spec: StreamSpec): { hex: string; values: Record<string, unknown> } {
    if (!this.link.isOpen) throw new Error('Link is not open')
    const { msg, version } = this.resolve(spec)
    const values = new MessageValueSource(msg, spec.fields, version).next()
    const frame = this.frameFor(msg, values, spec)
    this.link.send(frame)
    return { hex: toHex(frame), values: displayValues(values) }
  }

  start(spec: StreamSpec): string {
    if (!this.link.isOpen) throw new Error('Link is not open')
    const { msg, version } = this.resolve(spec)
    if ((this.link.linkConfig?.mavlinkVersion ?? 2) === 1 && msg.id > 255) {
      throw new Error(`${msg.name} (id ${msg.id}) needs MAVLink 2`)
    }
    const id = `s${this.nextId++}`
    const startTime = Date.now()
    const stream: Stream = {
      id,
      spec,
      msg,
      startTime,
      source: new MessageValueSource(msg, spec.fields, version, startTime),
      nextDue: performance.now(),
      sent: 0,
      rateWindow: [],
      lastValues: {},
      lastFrame: new Uint8Array()
    }
    this.streams.set(id, stream)
    this.schedule(stream)
    return id
  }

  /** Applies edited values / rate to a running stream. */
  update(id: string, spec: StreamSpec): void {
    const s = this.streams.get(id)
    if (!s) return
    const { msg, version } = this.resolve(spec)
    s.spec = spec
    s.msg = msg
    // Keep the original start time so timestamps / sine phases continue smoothly.
    s.source = new MessageValueSource(msg, spec.fields, version, s.startTime)
    clearTimeout(s.timer)
    s.nextDue = performance.now()
    this.schedule(s)
  }

  stop(id: string): void {
    const s = this.streams.get(id)
    if (s) clearTimeout(s.timer)
    this.streams.delete(id)
  }

  stopAll(): void {
    for (const id of [...this.streams.keys()]) this.stop(id)
  }

  /** Re-binds running streams to freshly parsed definitions after a dialect file changed. */
  refreshDialect(dialectId: string): void {
    for (const s of this.streams.values()) {
      if (s.spec.dialectId !== dialectId) continue
      try {
        this.update(s.id, s.spec)
        s.error = undefined
      } catch (e) {
        s.error = (e as Error).message
      }
    }
  }

  private schedule(s: Stream): void {
    const rate = Math.min(MAX_RATE_HZ, Math.max(0.01, s.spec.rateHz || 1))
    const interval = 1000 / rate
    const tick = (): void => {
      if (!this.streams.has(s.id)) return
      const now = performance.now()
      let burst = 0
      while (s.nextDue <= now && burst < MAX_BURST) {
        this.emit(s)
        s.nextDue += interval
        burst++
      }
      // Too far behind (e.g. the machine slept): resync instead of flooding.
      if (s.nextDue < now - interval * MAX_BURST) s.nextDue = now + interval
      s.timer = setTimeout(tick, Math.max(0, s.nextDue - performance.now()))
    }
    tick()
  }

  private emit(s: Stream): void {
    if (!this.link.isOpen) return
    try {
      const values = s.source.next()
      const frame = this.frameFor(s.msg, values, s.spec)
      this.link.send(frame)
      s.sent++
      s.lastValues = values
      s.lastFrame = frame
      s.error = undefined
      const t = Date.now()
      s.rateWindow.push(t)
      while (s.rateWindow.length && s.rateWindow[0] < t - 2000) s.rateWindow.shift()
    } catch (e) {
      s.error = (e as Error).message
    }
  }

  status(): StreamStatus[] {
    const t = Date.now()
    return [...this.streams.values()].map((s) => {
      const recent = s.rateWindow.filter((x) => x >= t - 2000)
      return {
        id: s.id,
        spec: s.spec,
        running: true,
        sent: s.sent,
        actualHz: recent.length / 2,
        lastValues: displayValues(s.lastValues),
        lastFrameHex: toHex(s.lastFrame),
        error: s.error
      }
    })
  }

  // -------------------------------------------------------------------------
  // Automatic HEARTBEAT so a GCS recognises us as a vehicle.

  configureHeartbeat(dialectId: string | undefined, hb: HeartbeatConfig): void {
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    if (!hb.enabled) return
    const send = (): void => {
      if (!this.link.isOpen) return
      const hbSrc = this.heartbeatFor(dialectId)
      if (!hbSrc) return
      const values = hbSrc.source.next()
      Object.assign(values, {
        type: hb.type,
        autopilot: hb.autopilot,
        base_mode: hb.baseMode,
        custom_mode: hb.customMode,
        system_status: hb.systemStatus
      })
      this.link.send(this.frameFor(hbSrc.msg, values))
    }
    send()
    this.heartbeatTimer = setInterval(send, 1000 / Math.min(50, Math.max(0.1, hb.rateHz || 1)))
  }

  private heartbeatFor(dialectId?: string): { msg: MessageDef; source: MessageValueSource } | undefined {
    // Prefer the active dialect's HEARTBEAT, fall back to the bundled minimal.xml.
    for (const id of [dialectId, 'builtin:minimal.xml']) {
      if (!id) continue
      const d = this.dialects.get(id)
      const msg = d?.messages.find((m) => m.id === 0 && m.name === 'HEARTBEAT')
      if (!msg || !d) continue
      const key = `${id}@${d.loadedAt}`
      if (this.heartbeatSource?.key !== key) {
        this.heartbeatSource = { key, msg, source: new MessageValueSource(msg, {}, d.version ?? 3) }
      }
      return this.heartbeatSource
    }
    return undefined
  }

  dispose(): void {
    this.stopAll()
    clearInterval(this.heartbeatTimer)
  }
}
