import { contextBridge, ipcRenderer } from 'electron'
import type {
  PiCommand,
  PiDesktopApi,
  PiEvent,
  StartOptions
} from '../shared/types'

const api: PiDesktopApi = {
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
  platform: process.platform
}

contextBridge.exposeInMainWorld('piDesktop', api)
