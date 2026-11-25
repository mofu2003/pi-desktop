import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams
} from 'node:child_process'
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { promisify } from 'node:util'
import type {
  AgentMessage,
  BootstrapPayload,
  ContentBlock,
  PiCommand,
  PiCommandInfo,
  PiEvent,
  PiModel,
  PiResponse,
  PiSessionState,
  PiSessionStats,
  SessionListOptions,
  SessionSummary,
  SshTarget,
  StartOptions,
  ThinkingLevel
} from '../shared/types'

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function shellDirExpr(remoteCwd?: string): string {
  const cwd = remoteCwd?.trim()
  if (!cwd || cwd === '~') return '"$HOME"'
  if (cwd.startsWith('~/')) return `"$HOME"/${shellSingleQuote(cwd.slice(2))}`
  return shellSingleQuote(cwd)
}

export function buildSshSpawnArgs(
  ssh: SshTarget,
  options: { idle?: boolean; sessionPath?: string } = {}
): string[] {
  const host = ssh.host.trim()
  if (!host || host.startsWith('-') || /[\s;|&$`<>\\'"()\r\n\0]/.test(host)) {
    throw new Error('SSH 主机地址格式不正确。')
  }

  const piArgs = ['pi', '--mode', 'rpc']
  if (options.idle) {
    piArgs.push('--no-session', '--no-extensions')
  } else if (options.sessionPath) {
    piArgs.push('--session', shellSingleQuote(options.sessionPath))
  }

  const remoteScript = [
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    `cd ${shellDirExpr(ssh.remoteCwd)} || exit 1`,
    `exec ${piArgs.join(' ')}`
  ].join('; ')

  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
  if (ssh.port && Number.isInteger(ssh.port) && ssh.port > 0 && ssh.port <= 65535) {
    args.push('-p', String(ssh.port))
  }
  args.push('--', host, `sh -lc ${shellSingleQuote(remoteScript)}`)
  return args
}

const ALLOWED_COMMANDS = new Set<PiCommand['type']>([
  'prompt',
  'steer',
  'follow_up',
  'abort',
  'clear_queue',
  'new_session',
  'get_state',
  'get_available_thinking_levels',
  'get_messages',
  'get_available_models',
  'set_model',
  'cycle_model',
  'set_thinking_level',
  'cycle_thinking_level',
  'set_steering_mode',
  'set_follow_up_mode',
  'set_auto_compaction',
  'set_auto_retry',
  'abort_retry',
  'bash',
  'abort_bash',
  'set_session_name',
  'get_session_stats',
  'export_html',
  'switch_session',
  'fork',
  'clone',
  'get_fork_messages',
  'get_entries',
  'get_tree',
  'get_last_assistant_text',
  'compact',
  'get_commands',
  'extension_ui_response'
])

type PendingRequest = {
  resolve: (response: PiResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function resolvePiBinary(bundledBinary?: string): string {
  if (bundledBinary) {
    const override = process.env.PI_BINARY?.trim()
    return override || bundledBinary
  }
  const candidates = [
    process.env.PI_BINARY,
    join(homedir(), '.npm-global', 'bin', 'pi'),
    join(homedir(), '.local', 'bin', 'pi'),
    '/opt/homebrew/bin/pi',
    '/usr/local/bin/pi'
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next known installation path.
    }
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const discovered = execFileSync(shell, ['-lc', 'command -v pi'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (discovered) return discovered
  } catch {
    // A shell lookup is a convenience; the known paths above remain valid.
  }

  return 'pi'
}

function piEnvironment(bundledBinary?: string): NodeJS.ProcessEnv {
  const paths = [
    ...(bundledBinary ? [dirname(bundledBinary)] : []),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin')
  ]
  return { ...process.env, PATH: [...new Set(paths)].join(delimiter) }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as ContentBlock[])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

function sessionRoot(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent')
  return join(resolve(agentDir), 'sessions')
}

function flattenSessionPath(cwd: string): string {
  let resolvedCwd = cwd
  try {
    resolvedCwd = realpathSync(cwd)
  } catch {
    // Fall back to the selected path if it no longer exists.
  }
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(sessionRoot(), safePath)
}

function parseSessionSummary(path: string): SessionSummary | null {
  try {
    const stats = statSync(path)
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    if (lines.length === 0) return null

    const header = JSON.parse(lines[0]) as {
      type?: string
      id?: string
      cwd?: string
      timestamp?: string
    }
    if (header.type !== 'session' || !header.id) return null

    let name: string | undefined
    let firstUserMessage = ''
    let messageCount = 0

    for (const line of lines.slice(1)) {
      try {
        const entry = JSON.parse(line) as {
          type?: string
          name?: string
          message?: AgentMessage
        }
        if (entry.type === 'session_info') {
          name = entry.name?.trim() || undefined
        }
        if (entry.type === 'message' && entry.message) {
          messageCount += 1
          if (!firstUserMessage && entry.message.role === 'user') {
            firstUserMessage = textFromContent(entry.message.content).trim()
          }
        }
      } catch {
        // Ignore one malformed line rather than dropping the whole session.
      }
    }

    const fallback = '未命名会话'
    const preview = firstUserMessage || fallback
    return {
      id: header.id,
      path,
      cwd: header.cwd || '',
      name,
      title: name || firstUserMessage || fallback,
      preview,
      messageCount,
      created: header.timestamp || stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString()
    }
  } catch {
    return null
  }
}

export function listProjectSessions(
  cwd: string,
  { retainPaths = [], excludePaths = [], includeAll = false }: SessionListOptions = {}
): SessionSummary[] {
  const sessionDir = flattenSessionPath(cwd)
  if (!existsSync(sessionDir)) return []

  const retained = new Set(retainPaths)
  const excluded = new Set(excludePaths)
  return readdirSync(sessionDir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => {
      const path = join(sessionDir, name)
      if (excluded.has(path)) return []
      const stats = statSync(path, { throwIfNoEntry: false })
      return stats?.isFile() ? [{ path, modified: stats.mtimeMs }] : []
    })
    .sort((a, b) => b.modified - a.modified)
    .filter(({ path }, index) => includeAll || index < 40 || retained.has(path))
    .map(({ path }) => parseSessionSummary(path))
    .filter((session): session is SessionSummary => session !== null)
    .filter(({ path }, index) => includeAll || index < 20 || retained.has(path))
}

export function getDeletableSessionPath(cwd: string, path: string): string {
  const sessionDir = flattenSessionPath(cwd)
  const file = resolve(path)
  if (dirname(file) !== sessionDir || extname(file) !== '.jsonl' ||
      !lstatSync(file, { throwIfNoEntry: false })?.isFile() || !parseSessionSummary(file)) {
    throw new Error('找不到可删除的 Pi 会话。')
  }
  return file
}

export function moveSessionFile(cwd: string, path: string, targetCwd: string): SessionSummary {
  const source = getDeletableSessionPath(cwd, path)
  const target = realpathSync(targetCwd)
  if (!statSync(target).isDirectory()) throw new Error('项目目录不存在。')
  const directory = flattenSessionPath(target)
  const destination = join(directory, basename(source))
  if (destination === source) {
    if (target !== realpathSync(cwd)) throw new Error('两个项目使用了相同的会话目录。')
    return parseSessionSummary(source)!
  }

  const text = readFileSync(source, 'utf8')
  const newline = text.indexOf('\n')
  const header = JSON.parse(newline === -1 ? text : text.slice(0, newline))
  mkdirSync(directory, { recursive: true })
  const temporary = join(directory, `.${randomBytes(12).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ ...header, cwd: target }) +
      (newline === -1 ? '\n' : text.slice(newline)), { flag: 'wx', mode: 0o600, flush: true })
    linkSync(temporary, destination)
    try {
      unlinkSync(source)
    } catch (error) {
      unlinkSync(destination)
      throw error
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  return parseSessionSummary(destination)!
}

export function readSessionMarkdown(cwd: string, path: string): string {
  const file = getDeletableSessionPath(cwd, path)
  const entries = new Map<string, { parentId?: string | null; message?: AgentMessage }>()
  let leaf: string | null = null
  for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (typeof entry?.id !== 'string') continue
      entries.set(entry.id, entry)
      leaf = entry.id
    } catch {
      continue
    }
  }
  const visited = new Set<string>()
  const blocks: string[] = []
  while (leaf && !visited.has(leaf)) {
    visited.add(leaf)
    const entry = entries.get(leaf)
    if (!entry) break
    const message = entry.message
    if (message?.role === 'user' || message?.role === 'assistant') {
      const content = textFromContent(message.content)
      if (content) blocks.push(`## ${message.role === 'user' ? '你' : 'Pi'}\n\n${content}`)
    }
    leaf = entry.parentId ?? null
  }
  return blocks.reverse().join('\n\n')
}

export function findSessionById(id: string): SessionSummary | undefined {
  const root = sessionRoot()
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id) || !existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(`_${id}.jsonl`) && name !== `${id}.jsonl`) continue
      const path = join(directory, name)
      if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) continue
      const session = parseSessionSummary(path)
      if (session?.id === id && session.cwd && flattenSessionPath(session.cwd) === directory) return session
    }
  }
}

const runGit = promisify(execFile)

export async function forkSessionInWorktree(
  userData: string,
  cwd: string,
  path: string
): Promise<{ session: SessionSummary; project: { path: string; name: string } }> {
  const source = getDeletableSessionPath(cwd, path)
  const text = readFileSync(source, 'utf8')
  const newline = text.indexOf('\n')
  if (newline === -1) throw new Error('此会话暂无可分叉的内容。')
  const header = JSON.parse(text.slice(0, newline))
  const parent = join(userData, 'worktrees')
  mkdirSync(parent, { recursive: true })
  const created = mkdtempSync(join(realpathSync(parent), 'pi-'))
  try {
    await runGit('git', ['worktree', 'add', '--detach', created, 'HEAD'], { cwd, timeout: 60_000 })
  } catch (error) {
    try { rmdirSync(created) } catch { /* Preserve a checkout Git may have created. */ }
    throw error
  }
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  const directory = flattenSessionPath(created)
  const file = join(directory, `${timestamp.replace(/[:.]/g, '-')}_${id}.jsonl`)
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, JSON.stringify({ ...header, id, cwd: created, timestamp, parentSession: source })
      + text.slice(newline), { flag: 'wx', mode: 0o600, flush: true })
  } catch (error) {
    await runGit('git', ['worktree', 'remove', created], { cwd, timeout: 30_000 })
    throw error
  }
  return { session: parseSessionSummary(file)!, project: { path: created, name: `${basename(cwd)} · ${basename(created)}` } }
}

export function renameSessionFile(cwd: string, path: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('请输入会话名称。')
  const file = getDeletableSessionPath(cwd, path)
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  let parentId: string | null = null
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as { id?: unknown }
      if (typeof entry.id === 'string' && entry.id) {
        parentId = entry.id
        break
      }
    } catch {
      // Ignore malformed trailing lines.
    }
  }
  const entry = {
    type: 'session_info',
    id: randomBytes(4).toString('hex'),
    parentId,
    timestamp: new Date().toISOString(),
    name: trimmed
  }
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
}

export class PiHost extends EventEmitter {
  private readonly bundledBinary?: string
  private child?: ChildProcessWithoutNullStreams
  private decoder = new StringDecoder('utf8')
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pending = new Map<string, PendingRequest>()
  private requestId = 0
  private starting = false
  private retrying = false
  private cwd = ''
  private binary = ''
  private sshTarget?: SshTarget

  constructor(bundledBinary?: string) {
    super()
    this.bundledBinary = bundledBinary
  }

  get currentCwd(): string {
    return this.cwd
  }

  get piPath(): string {
    return this.binary
  }

  get isBusy(): boolean {
    return this.starting || this.pending.size > 0 || (Boolean(this.child) && this.retrying)
  }

  get isRunning(): boolean {
    return Boolean(this.child && !this.child.killed)
  }

  startIdle(cwd: string): Promise<BootstrapPayload> {
    return this.start({ cwd }, true)
  }

  async start(options: StartOptions, idle = false): Promise<BootstrapPayload> {
    if (this.starting) throw new Error('Pi 正在连接，请稍候。')
    if (!options.ssh && !statSync(options.cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error('项目目录不存在。请重新选择项目。')
    }
    this.starting = true
    try {
      return await this.startChild(options, idle)
    } finally {
      this.starting = false
    }
  }

  private async startChild(options: StartOptions, idle: boolean): Promise<BootstrapPayload> {
    await this.stop(false)
    this.sshTarget = options.ssh
    this.cwd = options.ssh ? (options.ssh.remoteCwd || options.cwd || '~') : options.cwd
    this.retrying = false
    this.binary = options.ssh ? 'ssh' : resolvePiBinary(this.bundledBinary)
    this.stderrBuffer = ''
    this.stdoutBuffer = ''
    this.decoder = new StringDecoder('utf8')

    const child = options.ssh
      ? spawn('ssh', buildSshSpawnArgs(options.ssh, { idle, sessionPath: options.sessionPath }), {
          stdio: ['pipe', 'pipe', 'pipe']
        })
      : (() => {
          const args = ['--mode', 'rpc']
          if (idle) {
            args.push('--no-session', '--no-extensions')
          } else if (options.sessionPath) {
            args.push('--session', options.sessionPath)
          }
          return spawn(this.binary, args, {
            cwd: options.cwd,
            env: piEnvironment(this.binary === this.bundledBinary ? this.bundledBinary : undefined),
            stdio: ['pipe', 'pipe', 'pipe']
          })
        })()
    this.child = child

    // Failed RPC writes already reject their requests in the write callback.
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child === child) this.handleStdout(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.stderrBuffer += chunk.toString()
      if (this.stderrBuffer.length > 120_000) {
        this.stderrBuffer = this.stderrBuffer.slice(-60_000)
      }
    })
    child.on('error', (error) => this.handleExit(child, error))
    child.on('exit', (code, signal) => {
      const detail = signal ? `信号 ${signal}` : `退出码 ${code ?? '未知'}`
      this.handleExit(child, new Error(`Pi 已退出（${detail}）。${this.stderrTail()}`))
    })

    try {
      const [state, messages, modelResponse, statsResponse, commandResponse] =
        await Promise.all([
          this.requestState(),
          this.request<{ messages: AgentMessage[] }>({ type: 'get_messages' }),
          this.request<{ models: PiModel[] }>({ type: 'get_available_models' }),
          this.request<PiSessionStats>({ type: 'get_session_stats' }),
          this.request<{ commands: PiCommandInfo[] }>({ type: 'get_commands' })
        ])

      if (!state.success || !state.data) {
        throw new Error(state.error || 'Pi 未返回会话状态。')
      }
      return {
        cwd: this.cwd,
        piPath: this.binary,
        ssh: this.sshTarget,
        state: state.data,
        messages: messages.data?.messages ?? [],
        models: modelResponse.data?.models ?? [],
        stats: statsResponse.data,
        commands: commandResponse.data?.commands ?? []
      }
    } catch (error) {
      await this.stop(false)
      const message = error instanceof Error ? error.message : String(error)
      const stderr = this.stderrTail()
      if (this.sshTarget) {
        const hostLabel = this.sshTarget.label || this.sshTarget.host
        if (/permission denied/i.test(stderr)) {
          throw new Error(`SSH 主机「${hostLabel}」免密认证失败，请检查 SSH 密钥或 ssh-agent。\n${stderr}`)
        }
        if (/host key verification failed/i.test(stderr)) {
          throw new Error(`SSH 主机「${hostLabel}」主机密钥校验未通过，请先在终端执行一次 ssh ${this.sshTarget.host} 确认指纹。\n${stderr}`)
        }
        if (/command not found|not found/i.test(stderr)) {
          throw new Error(`远程主机「${hostLabel}」未找到 pi 命令，请确认已在远端安装 pi。\n${stderr}`)
        }
        if (/timed out|could not resolve|connection refused/i.test(stderr)) {
          throw new Error(`无法连接到 SSH 主机「${hostLabel}」。\n${stderr}`)
        }
      }
      if (message.includes('ENOENT')) {
        throw new Error(
          this.sshTarget
            ? '找不到系统 ssh 客户端命令。'
            : this.binary === this.bundledBinary
              ? '找不到安装包内置的 Pi。请重新安装 Pi Desktop。'
              : '找不到 Pi 命令行工具。请检查 Pi 的安装路径。'
        )
      }
      throw new Error(stderr && !message.includes(stderr) ? `${message}\n${stderr}` : message)
    }
  }

  async command<T = unknown>(
    command: PiCommand
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    if (!ALLOWED_COMMANDS.has(command.type)) {
      return { success: false, error: `不支持的 Pi 命令：${command.type}` }
    }
    if (!this.child || this.child.killed) {
      return { success: false, error: 'Pi 未运行。' }
    }

    try {
      const response = command.type === 'get_state' ? await this.requestState() : await this.request<T>(command)
      return {
        success: response.success,
        data: response.data as T,
        error: response.error
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async requestState(): Promise<PiResponse<PiSessionState>> {
    const [state, capabilities] = await Promise.all([
      this.request<PiSessionState>({ type: 'get_state' }),
      this.request<{ levels: ThinkingLevel[] }>({ type: 'get_available_thinking_levels' }).catch(() => undefined)
    ])
    const levels = capabilities?.success ? capabilities.data?.levels : undefined
    if (!state.data || !Array.isArray(levels)) return state
    return { ...state, data: { ...state.data, availableThinkingLevels: levels } }
  }

  async stop(emit = true): Promise<void> {
    if (!this.child) return
    const child = this.child
    this.child = undefined

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Pi 已停止。'))
    }
    this.pending.clear()

    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end()
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          resolve()
        }, 1500)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }

    if (emit) this.emit('event', { type: 'host_stopped' })
  }

  private request<T = unknown>(command: PiCommand): Promise<PiResponse<T>> {
    const child = this.child
    if (!child || !child.stdin.writable) {
      return Promise.reject(new Error('Pi 未运行。'))
    }

    const id = `desktop-${++this.requestId}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi 命令超时：${command.type}`))
      }, 30_000)

      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer)
          resolve(response as PiResponse<T>)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
        timer
      })

      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += this.decoder.write(chunk)

    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line.trim()) continue

      try {
        const message = JSON.parse(line) as PiResponse | PiEvent
        if (message.type === 'response' && message.id) {
          const pending = this.pending.get(message.id)
          if (pending) {
            this.pending.delete(message.id)
            pending.resolve(message)
          }
          continue
        }
        if (message.type === 'auto_retry_start') this.retrying = true
        if (message.type === 'auto_retry_end' || message.type === 'agent_settled') this.retrying = false
        this.emit('event', message)
      } catch {
        this.emit('protocol_error', line.slice(0, 2000))
      }
    }
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return
    this.child = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.emit('event', {
      type: 'host_error',
      error: error.message
    })
  }

  private stderrTail(): string {
    return this.stderrBuffer.trim().split('\n').slice(-8).join('\n').trim()
  }
}

export function projectName(path: string): string {
  return basename(path) || path
}
