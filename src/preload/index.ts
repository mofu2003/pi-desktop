import { contextBridge, ipcRenderer } from 'electron'
import type {
  AvailableUpdate,
  PiCommand,
  PiDesktopApi,
  PiEvent,
  StartOptions
} from '../shared/types'

const api: PiDesktopApi = {
  listCustomization: (cwd) => ipcRenderer.invoke('customization:list', cwd),
  revealCustomization: (id) => ipcRenderer.invoke('customization:reveal', id),
  getCustomizationDetail: (id) => ipcRenderer.invoke('customization:detail', id),
  readCustomizationFile: (id, file) => ipcRenderer.invoke('customization:file', id, file),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  listSessions: (cwd: string) => ipcRenderer.invoke('sessions:list', cwd),
  start: (options: StartOptions) => ipcRenderer.invoke('pi:start', options),
  command: (command: PiCommand) => ipcRenderer.invoke('pi:command', command),
  stop: () => ipcRenderer.invoke('pi:stop'),
  onEvent: (listener: (event: PiEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PiEvent): void =>
      listener(payload)
    ipcRenderer.on('pi:event', handler)
    return () => ipcRenderer.removeListener('pi:event', handler)
  },
  onMenuNewSession: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('menu:new-session', handler)
    return () => ipcRenderer.removeListener('menu:new-session', handler)
  },
  getUpdate: () => ipcRenderer.invoke('update:state'),
  openUpdate: () => ipcRenderer.invoke('update:open'),
  onUpdateAvailable: (listener: (update: AvailableUpdate) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: AvailableUpdate
    ): void => listener(payload)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onMenuToggleSidebar: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('menu:toggle-sidebar', handler)
    return () => ipcRenderer.removeListener('menu:toggle-sidebar', handler)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('piDesktop', api)
