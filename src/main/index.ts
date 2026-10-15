import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, LinkConfig, StatsEvent, StreamSpec } from '@shared/types'
import { DialectStore } from './dialects'
import { Link } from './link'
import { Streamer } from './streamer'

const dataDir = app.getPath('userData')
const bundledDir = app.isPackaged
  ? join(process.resourcesPath, 'definitions')
  : join(app.getAppPath(), 'resources', 'definitions')

let win: BrowserWindow | null = null
const settingsPath = join(dataDir, 'settings.json')

function readSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch {
    return {}
  }
}
let settings = readSettings()

const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#09090b' : '#fcfcfd')

// The renderer follows prefers-color-scheme, which Electron derives from themeSource.
function applyTheme(): void {
  nativeTheme.themeSource = settings.theme ?? 'system'
  win?.setBackgroundColor(windowBackground())
}

const dialects = new DialectStore(dataDir, bundledDir, (id) => {
  streamer.refreshDialect(id)
  win?.webContents.send('dialects:changed', id)
})
const link = new Link()
const streamer = new Streamer(dialects, link)

function applyHeartbeat(): void {
  const cfg = link.linkConfig
  if (cfg) streamer.configureHeartbeat(settings.activeDialectId, cfg.heartbeat)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'MAVLink Ephemeral',
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

function registerIpc(): void {
  ipcMain.handle('dialects:list', () => dialects.list())
  ipcMain.handle('dialects:get', (_e, id: string) => dialects.get(id))
  ipcMain.handle('dialects:importDialog', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import MAVLink definitions',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'MAVLink XML', extensions: ['xml'] }]
    })
    if (r.canceled) return { dialects: [], canceled: true }
    return { dialects: dialects.importPaths(r.filePaths) }
  })
  ipcMain.handle('dialects:importPaths', (_e, paths: string[]) => ({ dialects: dialects.importPaths(paths) }))
  ipcMain.handle('dialects:reload', (_e, id: string) => {
    const d = dialects.reload(id)
    streamer.refreshDialect(id)
    return d
  })
  ipcMain.handle('dialects:remove', (_e, id: string) => {
    for (const s of streamer.status()) if (s.spec.dialectId === id) streamer.stop(s.id)
    dialects.remove(id)
  })

  ipcMain.handle('link:open', async (_e, config: LinkConfig) => {
    const status = await link.open(config)
    applyHeartbeat()
    return status
  })
  ipcMain.handle('link:close', () => {
    streamer.stopAll()
    link.close()
  })
  ipcMain.handle('link:update', (_e, config: LinkConfig) => {
    link.updateConfig(config)
    if (link.isOpen) applyHeartbeat()
  })

  ipcMain.handle('stream:start', (_e, spec: StreamSpec) => streamer.start(spec))
  ipcMain.handle('stream:update', (_e, id: string, spec: StreamSpec) => streamer.update(id, spec))
  ipcMain.handle('stream:stop', (_e, id: string) => streamer.stop(id))
  ipcMain.handle('stream:stopAll', () => streamer.stopAll())
  ipcMain.handle('stream:sendOnce', (_e, spec: StreamSpec) => streamer.sendOnce(spec))
  ipcMain.handle('stream:preview', (_e, spec: StreamSpec) => streamer.preview(spec))

  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const prevDialect = settings.activeDialectId
    settings = { ...settings, ...patch }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    if (patch.activeDialectId && patch.activeDialectId !== prevDialect && link.isOpen) applyHeartbeat()
    if ('theme' in patch) applyTheme()
  })
}

app.whenReady().then(() => {
  applyTheme()
  nativeTheme.on('updated', () => win?.setBackgroundColor(windowBackground()))
  dialects.init()
  registerIpc()
  createWindow()
  setInterval(() => {
    const ev: StatsEvent = { link: link.snapshot(), streams: streamer.status() }
    win?.webContents.send('stats', ev)
  }, 250)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  streamer.dispose()
  link.close()
  dialects.dispose()
  if (process.platform !== 'darwin') app.quit()
})
