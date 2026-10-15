import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, StatsEvent } from '@shared/types'

const api: Api = {
  listDialects: () => ipcRenderer.invoke('dialects:list'),
  getDialect: (id) => ipcRenderer.invoke('dialects:get', id),
  importDialog: () => ipcRenderer.invoke('dialects:importDialog'),
  importPaths: (paths) => ipcRenderer.invoke('dialects:importPaths', paths),
  reloadDialect: (id) => ipcRenderer.invoke('dialects:reload', id),
  removeDialect: (id) => ipcRenderer.invoke('dialects:remove', id),
  pathForFile: (file) => webUtils.getPathForFile(file),

  openLink: (config) => ipcRenderer.invoke('link:open', config),
  closeLink: () => ipcRenderer.invoke('link:close'),
  updateLink: (config) => ipcRenderer.invoke('link:update', config),

  startStream: (spec) => ipcRenderer.invoke('stream:start', spec),
  updateStream: (id, spec) => ipcRenderer.invoke('stream:update', id, spec),
  stopStream: (id) => ipcRenderer.invoke('stream:stop', id),
  stopAllStreams: () => ipcRenderer.invoke('stream:stopAll'),
  sendOnce: (spec) => ipcRenderer.invoke('stream:sendOnce', spec),
  preview: (spec) => ipcRenderer.invoke('stream:preview', spec),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  onStats: (cb) => {
    const h = (_e: unknown, s: StatsEvent): void => cb(s)
    ipcRenderer.on('stats', h)
    return () => ipcRenderer.removeListener('stats', h)
  },
  onDialectsChanged: (cb) => {
    const h = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('dialects:changed', h)
    return () => ipcRenderer.removeListener('dialects:changed', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
