import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createWriteStream, renameSync } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { promisify } from 'node:util'
import type { AvailableUpdate } from '../shared/types'

const run = promisify(execFile)
const maxInstallerSize = 512 * 1024 * 1024
const downloadTimeout = 20 * 60_000
type FetchInstaller = (url: string, options: RequestInit) => Promise<Response>

export interface StagedMacUpdate {
  directory: string
  appPath: string
  stagedPath: string
}

export async function discardMacUpdate(directory: string): Promise<void> {
  // Electron's filesystem treats app.asar as a virtual directory.
  await run('/bin/rm', ['-rf', directory], { timeout: 60_000 })
}

export async function locateInstalledMacApp(executable: string): Promise<string> {
  const appPath = resolve(dirname(executable), '../..')
  if (basename(appPath) !== 'Pi.app' || appPath.startsWith('/Volumes/') ||
      appPath.includes('/AppTranslocation/')) {
    throw new Error('请从「应用程序」打开已安装的 Pi。')
  }
  if (!(await lstat(appPath)).isDirectory() || await realpath(appPath) !== appPath) {
    throw new Error('无法确定 Pi 的安装位置。')
  }
  await access(dirname(appPath), constants.W_OK)
  return appPath
}

async function downloadInstaller(
  update: AvailableUpdate,
  destination: string,
  fetchInstaller: FetchInstaller,
  onProgress: (progress: number) => void
): Promise<void> {
  if (!update.sha256 || !/^[a-f0-9]{64}$/.test(update.sha256)) {
    throw new Error('此版本的安装包缺少 SHA-256 校验值。')
  }
  if (update.size && update.size > maxInstallerSize) throw new Error('安装包超出大小限制。')
  const signal = AbortSignal.timeout(downloadTimeout)
  const response = await fetchInstaller(update.downloadUrl, { credentials: 'omit', signal })
  if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）。`)

  const hash = createHash('sha256')
  let bytes = 0
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length
      if (bytes > maxInstallerSize || (update.size && bytes > update.size)) {
        done(new Error('安装包大小与发布信息不符。'))
        return
      }
      hash.update(chunk)
      if (update.size) onProgress(Math.min(0.99, bytes / update.size))
      done(null, chunk)
    }
  })
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    measure,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    { signal }
  )
  if ((update.size && bytes !== update.size) || hash.digest('hex') !== update.sha256) {
    throw new Error('安装包校验失败。')
  }
}

async function verifyBundle(path: string, version: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) throw new Error('安装包中的 Pi.app 无效。')
  const plist = join(path, 'Contents', 'Info.plist')
  const field = async (key: string) =>
    (await run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, plist], { timeout: 5000 })).stdout.trim()
  const [id, actualVersion] = await Promise.all([
    field('CFBundleIdentifier'),
    field('CFBundleShortVersionString')
  ])
  if (id !== 'com.pi.desktop' || actualVersion !== version) {
    throw new Error('应用标识或版本与发布信息不符。')
  }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], { timeout: 60_000 })
}

export async function stageMacUpdate(
  update: AvailableUpdate,
  appPath: string,
  fetchInstaller: FetchInstaller,
  onProgress: (progress: number) => void
): Promise<StagedMacUpdate> {
  const directory = await mkdtemp(join(dirname(appPath), '.pi-update-'))
  const dmg = join(directory, 'update.dmg')
  const mount = join(directory, 'image')
  const stagedPath = join(directory, 'Pi.app')
  let attached = false
  try {
    await downloadInstaller(update, dmg, fetchInstaller, onProgress)
    await mkdir(mount)
    await run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount],
      { timeout: 120_000 })
    attached = true
    const source = join(mount, 'Pi.app')
    if (!(await lstat(source)).isDirectory()) throw new Error('安装包缺少 Pi.app。')
    await run('/usr/bin/ditto', [source, stagedPath], { timeout: 120_000 })
    await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 })
    attached = false
    await verifyBundle(stagedPath, update.version)
    await rm(dmg)
    return { directory, appPath, stagedPath }
  } catch (error) {
    if (attached) {
      await run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 })
    }
    await discardMacUpdate(directory)
    throw error
  }
}

export function replaceMacApp(update: StagedMacUpdate, scheduleRestart: () => void): void {
  const backup = join(update.directory, 'previous.app')
  renameSync(update.appPath, backup)
  let replaced = false
  try {
    renameSync(update.stagedPath, update.appPath)
    replaced = true
    scheduleRestart()
  } catch (error) {
    if (replaced) renameSync(update.appPath, update.stagedPath)
    renameSync(backup, update.appPath)
    throw error
  }
}
