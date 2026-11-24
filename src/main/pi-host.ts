import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams
} from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
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
  SessionSummary,
  StartOptions
} from '../shared/types'

const ALLOWED_COMMANDS = new Set<PiCommand['type']>([
  'prompt',
  'steer',
  'follow_up',
  'abort',
  'new_session',
  'get_state',
  'get_messages',
  'get_available_models',
  'set_model',
  'set_thinking_level',
  'set_session_name',
  'get_session_stats',
  'switch_session',
  'compact',
  'get_commands',
  'extension_ui_response'
])

type PendingRequest = {
  resolve: (response: PiResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function resolvePiBinary(): string {
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

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as ContentBlock[])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

function flattenSessionPath(cwd: string): string {
  let resolvedCwd = cwd
  try {
    resolvedCwd = realpathSync(cwd)
  } catch {
    // Fall back to the selected path if it no longer exists.
  }
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(homedir(), '.pi', 'agent', 'sessions', safePath)
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

export function listProjectSessions(cwd: string): SessionSummary[] {
  const sessionDir = flattenSessionPath(cwd)
  if (!existsSync(sessionDir)) return []

  return readdirSync(sessionDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(sessionDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 40)
    .map(parseSessionSummary)
    .filter((session): session is SessionSummary => session !== null)
    .slice(0, 20)
}

export class PiHost extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams
  private decoder = new StringDecoder('utf8')
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pending = new Map<string, PendingRequest>()
  private requestId = 0
  private stopping = false
  private cwd = ''
  private binary = ''

  get currentCwd(): string {
    return this.cwd
  }

  get piPath(): string {
    return this.binary
  }

  async start(options: StartOptions): Promise<BootstrapPayload> {
    await this.stop(false)
    this.cwd = options.cwd
    this.binary = resolvePiBinary()
    this.stderrBuffer = ''

    const args = ['--mode', 'rpc']
    if (options.sessionPath) {
      args.push('--session', options.sessionPath)
    }

    const child = spawn(this.binary, args, {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.stopping = false

    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString()
      if (this.stderrBuffer.length > 120_000) {
        this.stderrBuffer = this.stderrBuffer.slice(-60_000)
      }
    })
    child.on('error', (error) => this.handleExit(error))
    child.on('exit', (code, signal) => {
      const detail = signal ? `信号 ${signal}` : `退出码 ${code ?? '未知'}`
      this.handleExit(new Error(`Pi 已退出（${detail}）。${this.stderrTail()}`))
    })

    try {
      const [state, messages, modelResponse, statsResponse, commandResponse] =
        await Promise.all([
          this.request<PiSessionState>({ type: 'get_state' }),
          this.request<{ messages: AgentMessage[] }>({ type: 'get_messages' }),
          this.request<{ models: PiModel[] }>({ type: 'get_available_models' }),
          this.request<PiSessionStats>({ type: 'get_session_stats' }),
          this.request<{ commands: PiCommandInfo[] }>({ type: 'get_commands' })
        ])

      return {
        cwd: options.cwd,
        piPath: this.binary,
        state: state.data as PiSessionState,
        messages: messages.data?.messages ?? [],
        models: modelResponse.data?.models ?? [],
        stats: statsResponse.data,
        commands: commandResponse.data?.commands ?? []
      }
    } catch (error) {
      await this.stop(false)
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ENOENT')) {
        throw new Error(
          '找不到 Pi 命令行工具。请安装 Pi，并确认 PATH 中可以找到 pi。'
        )
      }
      throw new Error(
        `${message}${this.stderrTail() ? `\n${this.stderrTail()}` : ''}`
      )
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
      const response = await this.request<T>(command)
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

  async stop(emit = true): Promise<void> {
    if (!this.child) return
    this.stopping = true
    const child = this.child
    this.child = undefined

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Pi 已停止。'))
    }
    this.pending.clear()

    if (!child.killed) {
      child.stdin.end()
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
          resolve()
        }, 1500)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
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
        this.emit('event', message)
      } catch {
        this.emit('protocol_error', line.slice(0, 2000))
      }
    }
  }

  private handleExit(error: Error): void {
    if (this.stopping) return
    this.stopping = true
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
