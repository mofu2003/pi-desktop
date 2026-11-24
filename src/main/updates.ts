import { app, dialog, net, shell } from 'electron'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { LATEST_RELEASE_API, resolveUpdate } from './update-release'

let isChecking = false
let manualCheckRequested = false

export async function checkForUpdates(
  getWindow: () => BrowserWindow | null,
  isManual = false
): Promise<void> {
  manualCheckRequested ||= isManual
  if (isChecking) return
  isChecking = true

  const showMessage = (options: MessageBoxOptions) => {
    const window = getWindow()
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  try {
    const response = await net.fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      signal: AbortSignal.timeout(8_000)
    })
    if (!response.ok) throw new Error(`GitHub Releases returned ${response.status}`)

    const current = app.getVersion()
    const result = resolveUpdate(await response.json(), current, process.arch)
    if (result.status === 'available') {
      if (!manualCheckRequested && !getWindow()?.isVisible()) return
      const { response: choice } = await showMessage({
        type: 'info',
        title: 'Pi 更新',
        message: `Pi ${result.version} 已发布`,
        detail: `当前版本为 ${current}。下载 DMG 后，请退出 Pi 并用新版本替换现有应用。`,
        buttons: ['下载更新', '稍后'],
        defaultId: 0,
        cancelId: 1
      })
      if (choice === 0) {
        manualCheckRequested = true
        await shell.openExternal(result.downloadUrl)
      }
    } else if (manualCheckRequested) {
      await showMessage({
        type: 'info',
        title: 'Pi 更新',
        message: result.status === 'current'
          ? '当前已是最新版本'
          : `Pi ${result.version} 暂无适用的安装包`,
        detail: `当前版本为 ${current}。`,
        buttons: ['好']
      })
    }
  } catch {
    if (manualCheckRequested) {
      await showMessage({
        type: 'warning',
        title: 'Pi 更新',
        message: '暂时无法检查或下载更新',
        detail: '请确认可以访问 GitHub 后重试。',
        buttons: ['好']
      })
    }
  } finally {
    isChecking = false
    manualCheckRequested = false
  }
}
