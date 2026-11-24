import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { PiHost, listProjectSessions, projectName } from './pi-host'
import { checkForUpdates } from './updates'
import type { PiCommand, StartOptions } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const host = new PiHost()

function send(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

host.on('event', (event) => send('pi:event', event))
host.on('protocol_error', (line) => {
  send('pi:event', {
    type: 'extension_error',
    event: 'protocol',
    error: `无法解析 Pi 输出：${line}`
  })
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Pi',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 17 },
    backgroundColor: '#f7f7f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    void host.stop(false)
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Pi',
      submenu: [
        { role: 'about', label: '关于 Pi' },
        {
          label: '检查更新…',
          click: () => void checkForUpdates(() => mainWindow, true)
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

app.whenReady().then(() => {
  app.setName('Pi')
  buildMenu()
  createWindow()
  if (app.isPackaged) {
    mainWindow?.once('ready-to-show', () => void checkForUpdates(() => mainWindow))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void host.stop(false)
})

ipcMain.handle('project:choose', async () => {
  const options: Electron.OpenDialogOptions = {
    title: '打开项目',
    buttonLabel: '打开项目',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  const path = result.filePaths[0]
  return { path, name: projectName(path) }
})

ipcMain.handle('sessions:list', (_event, cwd: string) => {
  return listProjectSessions(cwd)
})

ipcMain.handle('pi:start', async (_event, options: StartOptions) => {
  return host.start(options)
})

ipcMain.handle('pi:command', async (_event, command: PiCommand) => {
  return host.command(command)
})

ipcMain.handle('pi:stop', async () => {
  await host.stop(false)
})
