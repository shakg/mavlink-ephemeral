// Types shared between the Electron main process, preload and the renderer.

export type BaseType =
  | 'char'
  | 'uint8_t'
  | 'int8_t'
  | 'uint16_t'
  | 'int16_t'
  | 'uint32_t'
  | 'int32_t'
  | 'uint64_t'
  | 'int64_t'
  | 'float'
  | 'double'

export interface FieldDef {
  name: string
  /** Base element type (uint8_t_mavlink_version is normalised to uint8_t). */
  type: BaseType
  /** Type string exactly as written in the XML, e.g. "uint8_t[16]". */
  rawType: string
  /** 0 for scalars, otherwise the array length. */
  arrayLength: number
  enum?: string
  units?: string
  display?: string
  invalid?: string
  description: string
  isExtension: boolean
  /** True for uint8_t_mavlink_version: always filled with the dialect version. */
  isMavlinkVersion?: boolean
  /** Byte offset inside the payload (wire order). */
  offset: number
}

export interface MessageDef {
  id: number
  name: string
  description: string
  /** Fields in XML declaration order (what the user sees). */
  fields: FieldDef[]
  crcExtra: number
  /** Payload length without extensions (MAVLink 1 length). */
  baseLength: number
  /** Payload length including extensions. */
  maxLength: number
  deprecated?: boolean
  wip?: boolean
  /** File the message was declared in. */
  file: string
}

export interface EnumEntry {
  name: string
  value: number
  description: string
}

export interface EnumDef {
  name: string
  bitmask: boolean
  description: string
  entries: EnumEntry[]
}

export interface DialectSummary {
  id: string
  name: string
  rootFile: string
  /** Absolute path of the file the user imported (for reload / watch). */
  sourcePath: string
  builtin: boolean
  version?: number
  messageCount: number
  enumCount: number
  files: { name: string; path: string; origin: 'source' | 'bundled' | 'cache' }[]
  errors: string[]
  warnings: string[]
  loadedAt: number
}

export interface Dialect extends DialectSummary {
  messages: MessageDef[]
  enums: Record<string, EnumDef>
}

// ---------------------------------------------------------------------------
// Value generators (phase 2: synthetic data)

export type GeneratorKind =
  | 'constant'
  | 'uniform'
  | 'sine'
  | 'ramp'
  | 'randomWalk'
  | 'counter'
  | 'timestamp'
  | 'choice'

export type TimestampUnit = 'boot_ms' | 'boot_us' | 'unix_us' | 'unix_ms' | 'unix_s'

export interface FieldGenerator {
  kind: GeneratorKind
  /** constant: value (string so 64-bit, NaN, hex and char arrays survive). Arrays: comma separated. */
  value?: string
  min?: number
  max?: number
  /** sine / ramp period in seconds. */
  period?: number
  /** sine phase offset in degrees. */
  phase?: number
  /** randomWalk max delta per tick, counter increment per tick. */
  step?: number
  /** randomWalk / counter start value. */
  start?: number
  timestampUnit?: TimestampUnit
  /** choice: comma separated list of values. */
  choices?: string
  choiceMode?: 'random' | 'cycle'
  /** Multiply the generated value before encoding (e.g. 1e7 for degE7 fields entered in degrees). */
  scale?: number
}

export type FieldConfig = Record<string, FieldGenerator>

export interface StreamSpec {
  dialectId: string
  messageName: string
  rateHz: number
  fields: FieldConfig
  /** Override the link's system/component id for this stream. */
  systemId?: number
  componentId?: number
}

export interface StreamStatus {
  id: string
  spec: StreamSpec
  running: boolean
  sent: number
  actualHz: number
  lastValues: Record<string, unknown>
  lastFrameHex: string
  error?: string
}

// ---------------------------------------------------------------------------
// Link

export type LinkProtocol = 'udp' | 'tcp-server' | 'tcp-client'

export interface HeartbeatConfig {
  enabled: boolean
  rateHz: number
  type: number
  autopilot: number
  baseMode: number
  customMode: number
  systemStatus: number
}

export interface LinkConfig {
  protocol: LinkProtocol
  /** UDP: destination host. TCP client: server host. TCP server: bind address. */
  host: string
  /** UDP: destination port. TCP: server port. */
  port: number
  /** UDP only: local port to bind (0 = any). */
  localPort: number
  systemId: number
  componentId: number
  mavlinkVersion: 1 | 2
  heartbeat: HeartbeatConfig
}

export interface LinkStatus {
  open: boolean
  state: string
  bytesSent: number
  bytesReceived: number
  framesSent: number
  peers: string[]
  /** Heartbeats seen from the other side, e.g. a GCS (sysid -> last seen ms). */
  remoteSystems: { systemId: number; componentId: number; lastSeen: number; msgCount: number }[]
  error?: string
}

export interface StatsEvent {
  link: LinkStatus
  streams: StreamStatus[]
}

export interface ImportResult {
  dialects: DialectSummary[]
  canceled?: boolean
}

export interface AppSettings {
  activeDialectId?: string
  link?: LinkConfig
  /** Saved field configs keyed by `${dialectId}/${messageName}`. */
  messageConfigs?: Record<string, { rateHz: number; fields: FieldConfig }>
  favorites?: string[]
  theme?: ThemePreference
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface Api {
  listDialects(): Promise<DialectSummary[]>
  getDialect(id: string): Promise<Dialect | null>
  importDialog(): Promise<ImportResult>
  importPaths(paths: string[]): Promise<ImportResult>
  reloadDialect(id: string): Promise<DialectSummary | null>
  removeDialect(id: string): Promise<void>
  pathForFile(file: File): string

  openLink(config: LinkConfig): Promise<LinkStatus>
  closeLink(): Promise<void>
  updateLink(config: LinkConfig): Promise<void>

  startStream(spec: StreamSpec): Promise<string>
  updateStream(id: string, spec: StreamSpec): Promise<void>
  stopStream(id: string): Promise<void>
  stopAllStreams(): Promise<void>
  sendOnce(spec: StreamSpec): Promise<{ hex: string; values: Record<string, unknown> }>
  preview(spec: StreamSpec): Promise<{ hex: string; values: Record<string, unknown>; error?: string }>

  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<void>

  onStats(cb: (s: StatsEvent) => void): () => void
  onDialectsChanged(cb: (changedId: string) => void): () => void
}
