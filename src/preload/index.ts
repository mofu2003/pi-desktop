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
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose-folder'),
  chooseImages: () => ipcRenderer.invoke('dialog:choose-images'),
  createProject: (name, sourceFolder) => ipcRenderer.invoke('project:create', name, sourceFolder),
  getUnassignedWorkspace: () => ipcRenderer.invoke('project:unassigned'),
  listSshHosts: () => ipcRenderer.invoke('ssh:list-hosts'),
  revealProject: (cwd) => ipcRenderer.invoke('project:reveal', cwd),
  listSessions: (cwd, options) => ipcRenderer.invoke('sessions:list', cwd, options),
  moveSession: (cwd, path, target) => ipcRenderer.invoke('sessions:move', cwd, path, target),
  copySessionMarkdown: (cwd, path) => ipcRenderer.invoke('sessions:copy-markdown', cwd, path),
  shareSession: (cwd, path) => ipcRenderer.invoke('sessions:share', cwd, path),
  openSessionPreview: (cwd, path, title) => ipcRenderer.invoke('sessions:open-preview', cwd, path, title),
  getSessionPreview: () => ipcRenderer.invoke('sessions:get-preview'),
  takeSessionLink: () => ipcRenderer.invoke('sessions:take-link'),
  onSessionLink: (listener) => {
    ipcRenderer.on('sessions:link', listener)
    return () => ipcRenderer.removeListener('sessions:link', listener)
  },
  forkSessionInWorktree: (cwd, path) => ipcRenderer.invoke('sessions:fork-worktree', cwd, path),
  deleteSession: (cwd, path) => ipcRenderer.invoke('sessions:delete', cwd, path),
  renameSessionFile: (cwd, path, name) => ipcRenderer.invoke('sessions:rename', cwd, path, name),
  trashSession: (cwd, path) => ipcRenderer.invoke('sessions:trash', cwd, path),
  chooseExportPath: (defaultName) => ipcRenderer.invoke('sessions:export-dialog', defaultName),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', path),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  setWindowTitle: (title) => ipcRenderer.invoke('window:set-title', title),
  connect: () => ipcRenderer.invoke('pi:connect'),
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
