import { app, dialog, net, shell } from 'electron'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { LATEST_RELEASE_API, resolveUpdate } from './update-release'
import type { AvailableUpdate, UpdateStatus } from '../shared/types'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 8_000

let availableUpdate: AvailableUpdate | null = null
let isChecking = false
let pollTimer: NodeJS.Timeout | null = null

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
  availableUpdate =
    status.status === 'available'
      ? { version: status.version, downloadUrl: status.downloadUrl }
      : null
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

/** Downloads the update the watcher found, ignoring stale renderer requests. */
export async function openAvailableUpdate(): Promise<boolean> {
  if (!availableUpdate) return false
  await shell.openExternal(availableUpdate.downloadUrl)
  return true
}

/** Manual check from the app menu: explains the outcome in a dialog. */
export async function checkForUpdates(
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (isChecking) return
  isChecking = true

  const showMessage = (options: MessageBoxOptions) => {
    const window = getWindow()
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  try {
    const status = await fetchLatestStatus()
    const current = app.getVersion()
    if (status.status === 'available') {
      const { response: choice } = await showMessage({
        type: 'info',
        title: 'Pi 更新',
        message: `Pi ${status.version} 已发布`,
        detail: `当前版本为 ${current}。下载 DMG 后，请退出 Pi 并用新版本替换现有应用。`,
        buttons: ['下载更新', '稍后'],
        defaultId: 0,
        cancelId: 1
      })
      if (choice === 0) await shell.openExternal(status.downloadUrl)
    } else {
      await showMessage({
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
    await showMessage({
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
