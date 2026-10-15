import { create } from 'zustand'
import type {
  AppSettings,
  Dialect,
  DialectSummary,
  FieldConfig,
  LinkConfig,
  MessageDef,
  StatsEvent,
  StreamSpec,
  StreamStatus
} from '@shared/types'

export const DEFAULT_LINK: LinkConfig = {
  protocol: 'udp',
  host: '127.0.0.1',
  port: 14550,
  localPort: 0,
  systemId: 1,
  componentId: 1,
  mavlinkVersion: 2,
  heartbeat: { enabled: true, rateHz: 1, type: 2, autopilot: 3, baseMode: 81, customMode: 0, systemStatus: 4 }
}

export interface MessageConfig {
  rateHz: number
  fields: FieldConfig
}

interface State {
  dialects: DialectSummary[]
  dialect: Dialect | null
  selected: string | null
  link: LinkConfig
  settings: AppSettings
  configs: Record<string, MessageConfig>
  stats: StatsEvent | null
  ready: boolean

  init(): Promise<void>
  refreshDialects(): Promise<void>
  selectDialect(id: string | null): Promise<void>
  selectMessage(name: string | null): void
  setLink(patch: Partial<LinkConfig>): void
  setConfig(messageName: string, cfg: MessageConfig): void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let pending: Partial<AppSettings> = {}
function persist(patch: Partial<AppSettings>): void {
  pending = { ...pending, ...patch }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void window.api.setSettings(pending)
    pending = {}
  }, 300)
}

export const configKey = (dialectId: string, message: string): string => `${dialectId}/${message}`

export const useStore = create<State>((set, get) => ({
  dialects: [],
  dialect: null,
  selected: null,
  link: DEFAULT_LINK,
  settings: {},
  configs: {},
  stats: null,
  ready: false,

  async init() {
    const [settings, dialects] = await Promise.all([window.api.getSettings(), window.api.listDialects()])
    set({
      settings,
      dialects,
      configs: settings.messageConfigs ?? {},
      link: { ...DEFAULT_LINK, ...settings.link, heartbeat: { ...DEFAULT_LINK.heartbeat, ...settings.link?.heartbeat } }
    })
    const active = settings.activeDialectId && dialects.some((d) => d.id === settings.activeDialectId)
    if (active) await get().selectDialect(settings.activeDialectId!)
    set({ ready: true })
    window.api.onStats((stats) => set({ stats }))
    window.api.onDialectsChanged(async (id) => {
      await get().refreshDialects()
      if (get().dialect?.id === id) {
        const d = await window.api.getDialect(id)
        set({ dialect: d })
      }
    })
  },

  async refreshDialects() {
    set({ dialects: await window.api.listDialects() })
  },

  async selectDialect(id) {
    if (!id) {
      set({ dialect: null, selected: null })
      return
    }
    const d = await window.api.getDialect(id)
    const prev = get().selected
    set({ dialect: d, selected: d?.messages.some((m) => m.name === prev) ? prev : null })
    void window.api.setSettings({ activeDialectId: id })
  },

  selectMessage(name) {
    set({ selected: name })
  },

  setLink(patch) {
    const link = { ...get().link, ...patch }
    set({ link })
    persist({ link })
    void window.api.updateLink(link)
  },

  setConfig(messageName, cfg) {
    const d = get().dialect
    if (!d) return
    const configs = { ...get().configs, [configKey(d.id, messageName)]: cfg }
    set({ configs })
    persist({ messageConfigs: configs })
  }
}))

export function useSelectedMessage(): MessageDef | null {
  return useStore((s) => s.dialect?.messages.find((m) => m.name === s.selected) ?? null)
}

export function streamFor(stats: StatsEvent | null, dialectId: string | undefined, message: string): StreamStatus | undefined {
  return stats?.streams.find((s) => s.spec.dialectId === dialectId && s.spec.messageName === message)
}

export function specFor(dialectId: string, message: string, cfg: MessageConfig): StreamSpec {
  return { dialectId, messageName: message, rateHz: cfg.rateHz, fields: cfg.fields }
}
