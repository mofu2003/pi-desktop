import { app, dialog, net, shell } from 'electron'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { discardMacUpdate, locateInstalledMacApp, replaceMacApp, stageMacUpdate, type StagedMacUpdate } from './mac-update'
import { LATEST_RELEASE_API, resolveUpdate } from './update-release'
import type { AvailableUpdate, UpdateStatus } from '../shared/types'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 8_000

let availableUpdate: AvailableUpdate | null = null
let isChecking = false
let isUpdating = false
let pollTimer: NodeJS.Timeout | null = null

type GetWindow = () => BrowserWindow | null
type PrepareRestart = () => Promise<() => void>

function showMessage(getWindow: GetWindow, options: MessageBoxOptions) {
  const window = getWindow()
  return window && !window.isDestroyed()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options)
}

export function getAvailableUpdate(): AvailableUpdate | null {
  return availableUpdate
}

async function fetchLatestStatus(): Promise<UpdateStatus> {
  const response = await net.fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`GitHub Releases returned ${response.status}`)

  const status = resolveUpdate(await response.json(), app.getVersion(), process.arch)
  if (status.status === 'available') {
    const { status: _status, ...update } = status
    availableUpdate = update
  } else {
    availableUpdate = null
  }
  return status
}

/**
 * Background check: never blocks the UI and never shows dialogs. Falls back to
 * the last known answer when GitHub is unreachable.
 */
export async function refreshAvailableUpdate(): Promise<AvailableUpdate | null> {
  try {
    await fetchLatestStatus()
  } catch {
    // Offline or rate limited: keep what we already know.
  }
  return availableUpdate
}

/** Checks once at startup and then every few hours, reporting new releases. */
export function startUpdateWatcher(
  onAvailableUpdate: (update: AvailableUpdate) => void
): void {
  if (pollTimer) return

  const check = async (): Promise<void> => {
    const update = await refreshAvailableUpdate()
    if (update) onAvailableUpdate(update)
  }

  void check()
  pollTimer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  pollTimer.unref()
}

export function stopUpdateWatcher(): void {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

export async function openAvailableUpdate(
  getWindow: GetWindow,
  prepareRestart: PrepareRestart,
  update = availableUpdate
): Promise<boolean> {
  if (!update || isUpdating) return false
  isUpdating = true
  let stage: StagedMacUpdate | undefined
  let installed = false
  let releaseRestartLock: (() => void) | undefined
  let lastProgress = -1
  const showProgress = (value: number): void => {
    const rounded = Math.round(value * 100)
    if (rounded === lastProgress) return
    lastProgress = rounded
    const window = getWindow()
    if (window && !window.isDestroyed()) window.setProgressBar(value)
  }

  try {
    const canInstall = app.isPackaged && process.platform === 'darwin' && Boolean(update.sha256)
    const { response } = await showMessage(getWindow, {
      type: 'info',
      title: 'Pi 更新',
      message: `Pi ${update.version} 已发布`,
      detail: canInstall
        ? `当前版本为 ${app.getVersion()}。下载完成后可以重启安装。`
        : `当前版本为 ${app.getVersion()}。此版本需要使用 DMG 手动安装。`,
      buttons: [canInstall ? '下载更新' : '下载 DMG', '稍后'],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return false
    if (!canInstall) {
      await shell.openExternal(update.downloadUrl)
      return true
    }

    const appPath = await locateInstalledMacApp(process.execPath)
    showProgress(2)
    stage = await stageMacUpdate(update, appPath, (url, init) => net.fetch(url, init), showProgress)
    showProgress(-1)
    const { response: restart } = await showMessage(getWindow, {
      type: 'info',
      title: 'Pi 更新',
      message: `Pi ${update.version} 已准备好安装`,
      detail: '重启会关闭当前窗口。请先等任务完成并保存草稿。',
      buttons: ['重启并安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    })
    if (restart !== 0) return false

    releaseRestartLock = await prepareRestart()
    replaceMacApp(stage, () => app.relaunch({ execPath: process.execPath }))
    installed = true
    return true
  } catch (error) {
    const backup = stage && join(stage.directory, 'previous.app')
    const detail = backup && existsSync(backup)
      ? `旧版备份已保留在 ${backup}。`
      : error instanceof Error ? error.message : '请稍后重试。'
    const { response } = await showMessage(getWindow, {
      type: 'warning',
      title: 'Pi 更新',
      message: '无法完成应用内更新',
      detail,
      buttons: ['关闭', '下载 DMG'],
      defaultId: 0,
      cancelId: 0
    })
    if (response === 1) await shell.openExternal(update.downloadUrl).catch(() => {})
    return false
  } finally {
    showProgress(-1)
    if (stage && (installed || !existsSync(join(stage.directory, 'previous.app')))) {
      await discardMacUpdate(stage.directory).catch(() => {})
    }
    if (installed) app.quit()
    else releaseRestartLock?.()
    isUpdating = false
  }
}

/** Manual check from the app menu: explains the outcome in a dialog. */
export async function checkForUpdates(
  getWindow: GetWindow,
  prepareRestart: PrepareRestart
): Promise<void> {
  if (isChecking || isUpdating) return
  isChecking = true

  try {
    const status = await fetchLatestStatus()
    const current = app.getVersion()
    if (status.status === 'available') {
      await openAvailableUpdate(getWindow, prepareRestart, status)
    } else {
      await showMessage(getWindow, {
        type: 'info',
        title: 'Pi 更新',
        message:
          status.status === 'current'
            ? '当前已是最新版本'
            : `Pi ${status.version} 暂无适用的安装包`,
        detail: `当前版本为 ${current}。`,
        buttons: ['好']
      })
    }
  } catch {
    await showMessage(getWindow, {
      type: 'warning',
      title: 'Pi 更新',
      message: '暂时无法检查或下载更新',
      detail: '请确认可以访问 GitHub 后重试。',
      buttons: ['好']
    })
  } finally {
    isChecking = false
  }
}
