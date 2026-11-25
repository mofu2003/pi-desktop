import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, ShareMenu, shell } from 'electron'
import { mkdir, readFile, realpath, stat, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  describeCustomization,
  listCustomizationResources,
  readSkillPreview,
  type LocatedCustomizationResource
} from './customization'
import {
  PiHost, findSessionById, forkSessionInWorktree, getDeletableSessionPath, listProjectSessions,
  moveSessionFile, projectName, readSessionMarkdown, renameSessionFile
} from './pi-host'
import { createProject } from './projects'
import { listSshHosts } from './ssh'
import { checkForUpdates, getAvailableUpdate, openAvailableUpdate, startUpdateWatcher, stopUpdateWatcher } from './updates'
import type { ImageContent, PiCommand, PiSessionState, SessionListOptions, StartOptions } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const host = new PiHost(app.isPackaged ? join(process.resourcesPath, 'pi-runtime', 'pi') : undefined)
let customizationEntries = new Map<string, LocatedCustomizationResource>()
let customizationRequest = 0
let pendingSessionLink: string | undefined
const sessionPreviews = new Map<number, { title: string; markdown: string }>()
let isInstallingUpdate = false
const updateWindow = () => mainWindow

async function prepareUpdateRestart(): Promise<() => void> {
  const busy = 'Pi 还有任务在运行，请等任务结束后重试。'
  if (isInstallingUpdate || host.isBusy) throw new Error(busy)
  isInstallingUpdate = true
  const release = () => { isInstallingUpdate = false }

  try {
    if (host.isRunning) {
      const state = await host.command<PiSessionState>({ type: 'get_state' })
      if (!state.success || !state.data) throw new Error('无法确认 Pi 当前的运行状态。')
      const { isStreaming, isCompacting, pendingMessageCount } = state.data
      if (isStreaming || isCompacting || pendingMessageCount > 0 || host.isBusy) throw new Error(busy)
    }
    return release
  } catch (error) {
    release()
    throw error
  }
}

function send(channel: string, payload: unknown): void {
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return
  contents.send(channel, payload)
}

host.on('event', (event) => send('pi:event', event))
host.on('protocol_error', (line) => {
  send('pi:event', {
    type: 'extension_error',
    event: 'protocol',
    error: `无法解析 Pi 输出：${line}`
  })
})

function createPiWindow(title = 'Pi'): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    ...(process.platform === 'darwin'
      ? { vibrancy: 'sidebar', backgroundColor: '#00000000' }
      : { backgroundColor: '#ffffff' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  return window
}

function loadRenderer(window: BrowserWindow, query: Record<string, string> = {}): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    void window.loadURL(url.href)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

function createWindow(): void {
  mainWindow = createPiWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
    void host.stop(false)
  })
  loadRenderer(mainWindow)
}

function openSessionLink(url: string): void {
  const id = /^pi-desktop:\/\/session\/([a-zA-Z0-9-]{1,128})\/?$/.exec(url)?.[1]
  if (!id) return
  pendingSessionLink = id
  if (!app.isReady()) return
  if (!mainWindow) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
  send('sessions:link', null)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Pi',
      submenu: [
        { role: 'about', label: '关于 Pi' },
        {
          label: '检查更新…',
          click: () => void checkForUpdates(updateWindow, prepareUpdateRestart)
        },
        { type: 'separator' },
        {
          label: '新建会话',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new-session', null)
        },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Pi' },
        { role: 'hideOthers', label: '隐藏其他应用' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Pi' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '展开或收起侧边栏',
          accelerator: 'CmdOrCtrl+B',
          click: () => send('menu:toggle-sidebar', null)
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放窗口' },
        { type: 'separator' },
        { role: 'front', label: '全部置于最前面' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    openSessionLink(url)
  })
  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setName('Pi')
    buildMenu()
    if (!mainWindow) createWindow()
    startUpdateWatcher((update) => send('update:available', update))

    app.on('activate', () => {
      if (!mainWindow) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopUpdateWatcher()
  void host.stop(false)
})

ipcMain.handle('project:choose-folder', async () => {
  const options: Electron.OpenDialogOptions = {
    title: '选择源文件夹',
    buttonLabel: '选择文件夹',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  const selected = result.filePaths[0]
  return { path: await realpath(selected), name: projectName(selected) }
})

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

ipcMain.handle('dialog:choose-images', async (): Promise<ImageContent[]> => {
  const options: Electron.OpenDialogOptions = {
    title: '选择图片附件',
    buttonLabel: '添加图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return []

  const images: ImageContent[] = []
  for (const filePath of result.filePaths) {
    const mimeType = IMAGE_MIME_TYPES[extname(filePath).toLowerCase()]
    if (!mimeType) continue
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile() || info.size > MAX_IMAGE_BYTES) continue
    const buffer = await readFile(filePath)
    images.push({
      type: 'image',
      data: buffer.toString('base64'),
      mimeType
    })
  }
  return images
})

ipcMain.handle('project:create', (_event, name: string, sourceFolder?: string) =>
  createProject(app.getPath('userData'), name, sourceFolder))

ipcMain.handle('project:unassigned', async () => {
  const path = join(app.getPath('userData'), 'workspace')
  await mkdir(path, { recursive: true })
  return { path: await realpath(path), name: '无项目', isUnassigned: true }
})

ipcMain.handle('ssh:list-hosts', () => listSshHosts())

ipcMain.handle('customization:list', async (_event, cwd?: string) => {
  const request = ++customizationRequest
  const entries = await listCustomizationResources(cwd)
  if (request === customizationRequest) {
    customizationEntries = new Map(entries.map((entry) => [entry.id, entry]))
  }
  return entries.map(({ location: _location, ...resource }) => resource)
})

ipcMain.handle('customization:reveal', (_event, id: string) => {
  const entry = customizationEntries.get(id)
  if (!entry) return false
  shell.showItemInFolder(entry.location)
  return true
})

ipcMain.handle('customization:detail', (_event, id: string) => {
  const entry = customizationEntries.get(id)
  if (!entry) throw new Error('找不到此资源，请刷新列表。')
  return describeCustomization(entry)
})

ipcMain.handle('customization:file', (_event, id: string, file: string) => {
  const entry = customizationEntries.get(id)
  if (!entry) throw new Error('找不到此资源，请刷新列表。')
  return readSkillPreview(entry, file)
})

ipcMain.handle('sessions:list', (_event, cwd: string, options?: SessionListOptions) => {
  return listProjectSessions(cwd, options)
})

ipcMain.handle('sessions:move', (_event, cwd: string, path: string, target: string) =>
  moveSessionFile(cwd, path, target))

ipcMain.handle('sessions:copy-markdown', (_event, cwd: string, path: string) => {
  const markdown = readSessionMarkdown(cwd, path)
  if (!markdown) throw new Error('此会话暂无可复制的内容。')
  clipboard.writeText(markdown)
})

ipcMain.handle('sessions:share', (event, cwd: string, path: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (process.platform !== 'darwin' || !owner) throw new Error('此平台没有系统分享菜单。')
  const markdown = readSessionMarkdown(cwd, path)
  if (!markdown) throw new Error('此会话暂无可分享的内容。')
  new ShareMenu({ texts: [markdown] }).popup({ window: owner })
})

ipcMain.handle('sessions:open-preview', (_event, cwd: string, path: string, title: string) => {
  const markdown = readSessionMarkdown(cwd, path)
  const window = createPiWindow(title)
  const id = window.webContents.id
  sessionPreviews.set(id, { title, markdown })
  window.once('closed', () => sessionPreviews.delete(id))
  loadRenderer(window, { preview: 'session' })
})

ipcMain.handle('sessions:get-preview', (event) => sessionPreviews.get(event.sender.id))

ipcMain.handle('sessions:take-link', (event) => {
  if (event.sender !== mainWindow?.webContents || !pendingSessionLink) return
  const id = pendingSessionLink
  pendingSessionLink = undefined
  const session = findSessionById(id)
  if (!session) throw new Error('此链接对应的本地 Pi 会话已找不到。')
  return session
})

ipcMain.handle('sessions:fork-worktree', (_event, cwd: string, path: string) =>
  forkSessionInWorktree(app.getPath('userData'), cwd, path))

ipcMain.handle('sessions:delete', (_event, cwd: string, path: string) =>
  unlink(getDeletableSessionPath(cwd, path)))

ipcMain.handle('sessions:rename', (_event, cwd: string, path: string, name: string) => {
  renameSessionFile(cwd, path, name)
})

ipcMain.handle('project:reveal', async (_event, cwd: string) => {
  if (!(await stat(cwd).catch(() => null))?.isDirectory()) {
    throw new Error('项目目录不存在。')
  }
  shell.showItemInFolder(cwd)
})

ipcMain.handle('sessions:trash', (_event, cwd: string, path: string) => {
  return shell.trashItem(getDeletableSessionPath(cwd, path))
})

ipcMain.handle('sessions:export-dialog', async (_event, defaultName: string) => {
  const options: Electron.SaveDialogOptions = {
    title: '导出会话为 HTML',
    defaultPath: defaultName,
    filters: [{ name: 'HTML 文件', extensions: ['html'] }]
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

ipcMain.handle('file:reveal', async (_event, path: string) => {
  if (!(await stat(path).catch(() => null))) {
    throw new Error('文件不存在。')
  }
  shell.showItemInFolder(path)
})

ipcMain.handle('clipboard:write', (_event, text: string) => {
  clipboard.writeText(text)
})

ipcMain.handle('window:set-title', (_event, title: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title || 'Pi')
  }
})

ipcMain.handle('update:state', () => getAvailableUpdate())

ipcMain.handle('update:open', () => openAvailableUpdate(updateWindow, prepareUpdateRestart))

ipcMain.handle('pi:start', async (_event, options: StartOptions) => {
  if (isInstallingUpdate) throw new Error('Pi 正在重启以安装更新。')
  return host.start(options)
})

ipcMain.handle('pi:connect', async () => {
  if (isInstallingUpdate) throw new Error('Pi 正在重启以安装更新。')
  await host.startIdle(app.getPath('userData'))
})

ipcMain.handle('pi:command', async (_event, command: PiCommand) => {
  if (isInstallingUpdate) return { success: false, error: 'Pi 正在重启以安装更新。' }
  return host.command(command)
})

ipcMain.handle('pi:stop', async () => {
  await host.stop(false)
})
