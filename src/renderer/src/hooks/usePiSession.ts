import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentMessage,
  BashResult,
  ContentBlock,
  ForkableMessage,
  ImageContent,
  PiCommandInfo,
  PiEvent,
  PiModel,
  PiSessionState,
  PiSessionStats,
  ProjectInfo,
  SessionSummary,
  ThinkingLevel,
  ToolExecution
} from '../../../shared/types'
import {
  applyAssistantMessageUpdate,
  contentToText,
  toolResultMap,
  upsertMessage
} from '../lib/pi'
import { userMessageEntryIds, type SessionEntryLike } from '../lib/message-meta'

type HostEvent =
  | PiEvent
  | { type: 'host_error'; error: string }
  | { type: 'host_stopped' }

export interface ExtensionRequest {
  id: string
  method: 'select' | 'confirm' | 'input' | 'editor'
  title: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
}

export interface ExtensionWidget {
  lines: string[]
  placement: 'aboveEditor' | 'belowEditor'
}

export interface ExtensionUiResponse {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

export interface PiNotification {
  status: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface OptimisticUserMessage {
  text: string
  images: ImageContent[]
}

interface UsePiSessionResult {
  project: ProjectInfo | null
  unassignedWorkspace: ProjectInfo | null
  sessions: SessionSummary[]
  state: PiSessionState | null
  messages: AgentMessage[]
  models: PiModel[]
  stats: PiSessionStats | null
  commands: PiCommandInfo[]
  toolExecutions: Record<string, ToolExecution>
  isStreaming: boolean
  isBashRunning: boolean
  runningBash: { command: string; output: string } | null
  isConnecting: boolean
  isRuntimeConnected: boolean
  isRetrying: boolean
  streamingBehavior: 'steer' | 'followUp'
  autoRetryEnabled: boolean
  queuedMessages: { steering: string[]; followUp: string[] }
  reconnect: () => Promise<void>
  activeSessionPath?: string
  optimisticUser: OptimisticUserMessage | null
  error: string | null
  notification: PiNotification | null
  status: string | null
  extensionRequest: ExtensionRequest | null
  commandStatuses: Record<string, string>
  widgets: Record<string, ExtensionWidget>
  editorPrefill: { seq: number; text: string } | null
  userEntryIds: Record<number, string>
  newSession: (project?: ProjectInfo | null) => Promise<boolean>
  renameSession: (path: string, name: string, sourceProject: ProjectInfo) => Promise<boolean>
  trashSession: (path: string, sourceProject: ProjectInfo) => Promise<boolean>
  moveSession: (path: string, source: ProjectInfo, target: ProjectInfo) => Promise<SessionSummary>
  deleteSession: (path: string, source: ProjectInfo) => Promise<void>
  forgetProject: (path: string) => Promise<void>
  reportError: (error: unknown) => void
  openSession: (path: string, sourceProject?: ProjectInfo) => Promise<boolean>
  send: (text: string, images?: ImageContent[]) => Promise<boolean>
  runBash: (command: string, excludeFromContext?: boolean) => Promise<boolean>
  abortBash: () => Promise<void>
  compact: (customInstructions?: string) => Promise<boolean>
  clearQueue: () => Promise<string[]>
  abortRetry: () => Promise<void>
  setStreamingBehavior: (behavior: 'steer' | 'followUp') => void
  setSteeringMode: (mode: 'all' | 'one-at-a-time') => Promise<void>
  setFollowUpMode: (mode: 'all' | 'one-at-a-time') => Promise<void>
  setAutoCompaction: (enabled: boolean) => Promise<void>
  setAutoRetry: (enabled: boolean) => Promise<void>
  getForkMessages: () => Promise<ForkableMessage[]>
  forkSession: (entryId: string) => Promise<boolean>
  retractUserMessage: (entryId: string) => Promise<boolean>
  cloneSession: () => Promise<boolean>
  exportSessionHtml: () => Promise<void>
  copyLastAssistantText: () => Promise<void>
  stop: () => Promise<void>
  setModel: (provider: string, modelId: string) => Promise<void>
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>
  respondToExtension: (response: ExtensionUiResponse) => Promise<void>
  dismissError: () => void
  dismissNotification: () => void
  refreshSessions: () => Promise<void>
}

function isSameProjectTarget(a?: ProjectInfo | null, b?: ProjectInfo | null): boolean {
  if (!a || !b) return a === b
  return a.path === b.path
    && a.ssh?.host === b.ssh?.host
    && a.ssh?.remoteCwd === b.ssh?.remoteCwd
    && a.ssh?.port === b.ssh?.port
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '与 Pi 通信时发生错误。'
}

export function usePiSession(): UsePiSessionResult {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [unassignedWorkspace, setUnassignedWorkspace] = useState<ProjectInfo | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [state, setState] = useState<PiSessionState | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [models, setModels] = useState<PiModel[]>([])
  const [stats, setStats] = useState<PiSessionStats | null>(null)
  const [commands, setCommands] = useState<PiCommandInfo[]>([])
  const [toolExecutions, setToolExecutions] = useState<Record<string, ToolExecution>>({})
  const [isStreaming, setIsStreaming] = useState(false)
  const [runningBash, setRunningBash] = useState<{ command: string; output: string } | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [isRuntimeConnected, setIsRuntimeConnected] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [streamingBehavior, setStreamingBehavior] = useState<'steer' | 'followUp'>('steer')
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true)
  const [queuedMessages, setQueuedMessages] = useState<{ steering: string[]; followUp: string[] }>({
    steering: [],
    followUp: []
  })
  const [activeSessionPath, setActiveSessionPath] = useState<string>()
  const [optimisticUser, setOptimisticUser] = useState<OptimisticUserMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<PiNotification | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [extensionRequest, setExtensionRequest] = useState<ExtensionRequest | null>(null)
  const [commandStatuses, setCommandStatuses] = useState<Record<string, string>>({})
  const [widgets, setWidgets] = useState<Record<string, ExtensionWidget>>({})
  const [editorPrefill, setEditorPrefill] = useState<{ seq: number; text: string } | null>(null)
  const [userEntryIds, setUserEntryIds] = useState<Record<number, string>>({})

  const stateRef = useRef<PiSessionState | null>(null)
  const projectRef = useRef<ProjectInfo | null>(null)
  const activeSessionRef = useRef<string | undefined>(undefined)
  const generationRef = useRef(0)
  const statsRequestRef = useRef(0)
  const prefillSeqRef = useRef(0)
  const isStartingRef = useRef(false)
  const isChangingSessionRef = useRef(false)
  const didConnectOnLaunch = useRef(false)

  const pushEditorPrefill = useCallback((text: string): void => {
    setEditorPrefill({ seq: ++prefillSeqRef.current, text })
  }, [])

  const updateState = useCallback((next: PiSessionState | null): void => {
    stateRef.current = next
    setState(next)
    setIsStreaming(Boolean(next?.isStreaming))
    activeSessionRef.current = next?.sessionFile
    setActiveSessionPath(next?.sessionFile)
  }, [])

  const refreshSessions = useCallback(async (): Promise<void> => {
    const currentProject = projectRef.current
    if (!currentProject || currentProject.ssh) {
      setSessions([])
      return
    }
    try {
      setSessions(await window.piDesktop.listSessions(currentProject.path))
    } catch (sessionError) {
      setError(errorMessage(sessionError))
    }
  }, [])

  const refreshStats = useCallback(async (generation: number): Promise<void> => {
    const request = ++statsRequestRef.current
    const result = await window.piDesktop.command<PiSessionStats>({
      type: 'get_session_stats'
    }).catch(() => null)
    if (generation === generationRef.current && request === statsRequestRef.current) {
      setStats(result?.success ? result.data ?? null : null)
    }
  }, [])

  const refreshAfterRun = useCallback(async (generation: number): Promise<void> => {
    const [stateResult, messagesResult, sessionsResult, entriesResult] = await Promise.all([
      window.piDesktop.command<PiSessionState>({ type: 'get_state' }),
      window.piDesktop.command<{ messages: AgentMessage[] }>({ type: 'get_messages' }),
      projectRef.current && !projectRef.current.ssh
        ? window.piDesktop.listSessions(projectRef.current.path)
        : Promise.resolve([]),
      window.piDesktop.command<{ entries: SessionEntryLike[]; leafId?: string | null }>({
        type: 'get_entries'
      }).catch(() => null),
      refreshStats(generation)
    ])

    if (generation !== generationRef.current) return
    if (stateResult.success && stateResult.data) updateState(stateResult.data)
    if (messagesResult.success && messagesResult.data) {
      setMessages(messagesResult.data.messages)
      setToolExecutions(toolResultMap(messagesResult.data.messages))
    }
    if (entriesResult?.success && entriesResult.data) {
      setUserEntryIds(userMessageEntryIds(entriesResult.data.entries, entriesResult.data.leafId))
    }
    setSessions(sessionsResult)
    setOptimisticUser(null)
    setStatus(null)
    setIsRetrying(false)
  }, [refreshStats, updateState])

  const startSession = useCallback(
    async (
      selectedProject: ProjectInfo,
      sessionPath?: string
    ): Promise<boolean> => {
      if (isStartingRef.current) return false
      isStartingRef.current = true
      const generation = ++generationRef.current
      setProject(selectedProject)
      projectRef.current = selectedProject
      setIsConnecting(true)
      setIsRuntimeConnected(false)
      setError(null)
      setStatus(null)
      setIsRetrying(false)
      setRunningBash(null)
      setQueuedMessages({ steering: [], followUp: [] })
      setOptimisticUser(null)
      setWidgets({})
      setCommandStatuses({})
      updateState(null)
      setStats(null)
      setMessages([])
      setSessions([])
      setToolExecutions({})
      setUserEntryIds({})
      activeSessionRef.current = sessionPath
      setActiveSessionPath(sessionPath)

      try {
        const payload = await window.piDesktop.start({
          cwd: selectedProject.path,
          sessionPath,
          ssh: selectedProject.ssh
        })
        if (generation !== generationRef.current) return false

        setIsRuntimeConnected(true)
        updateState(payload.state)
        setMessages(payload.messages)
        setToolExecutions(toolResultMap(payload.messages))
        setModels(payload.models)
        setStats(payload.stats ?? null)
        setCommands(payload.commands)
        const entriesResult = await window.piDesktop
          .command<{ entries: SessionEntryLike[]; leafId?: string | null }>({ type: 'get_entries' })
          .catch(() => null)
        if (generation !== generationRef.current) return false
        if (entriesResult?.success && entriesResult.data) {
          setUserEntryIds(userMessageEntryIds(entriesResult.data.entries, entriesResult.data.leafId))
        } else {
          setUserEntryIds({})
        }
        const resolvedPath = payload.state.sessionFile ?? sessionPath
        activeSessionRef.current = resolvedPath
        setActiveSessionPath(resolvedPath)
        const projectSessions = selectedProject.ssh
          ? []
          : await window.piDesktop.listSessions(selectedProject.path)
        if (generation !== generationRef.current) return false
        setSessions(projectSessions)
        return true
      } catch (startError) {
        if (generation === generationRef.current) setError(errorMessage(startError))
        return false
      } finally {
        isStartingRef.current = false
        if (generation === generationRef.current) setIsConnecting(false)
      }
    },
    [updateState]
  )

  const connectIdle = useCallback(async (): Promise<void> => {
    if (isStartingRef.current) return
    isStartingRef.current = true
    setIsConnecting(true)
    try {
      await window.piDesktop.connect()
      setIsRuntimeConnected(true)
    } catch (error) {
      setIsRuntimeConnected(false)
      setError(errorMessage(error))
    } finally {
      isStartingRef.current = false
      setIsConnecting(false)
    }
  }, [])

  const getUnassignedWorkspace = useCallback(async (): Promise<ProjectInfo> => {
    const workspace = await window.piDesktop.getUnassignedWorkspace()
    setUnassignedWorkspace(workspace)
    return workspace
  }, [])

  const reconnect = useCallback(async (): Promise<void> => {
    setError(null)
    const targetProject = projectRef.current ?? await getUnassignedWorkspace().catch(() => null)
    if (targetProject) await startSession(targetProject, activeSessionPath)
    else await connectIdle()
  }, [activeSessionPath, connectIdle, getUnassignedWorkspace, startSession])

  const newSession = useCallback(async (targetProject?: ProjectInfo | null): Promise<boolean> => {
    if (isStartingRef.current || isChangingSessionRef.current) return false
    const currentProject = (targetProject === undefined ? projectRef.current : targetProject)
      ?? await getUnassignedWorkspace()
    if (!stateRef.current || !isSameProjectTarget(currentProject, projectRef.current)) {
      return startSession(currentProject)
    }
    const generation = generationRef.current
    isChangingSessionRef.current = true
    setIsConnecting(true)
    setError(null)
    try {
      if (stateRef.current.isStreaming) {
        const response = await window.piDesktop.command({ type: 'abort' })
        if (!response.success) throw new Error(response.error || '无法停止当前任务。')
      }
      const response = await window.piDesktop.command<{ cancelled?: boolean }>({
        type: 'new_session'
      })
      if (!response.success) throw new Error(response.error || '无法新建会话。')
      if (response.data?.cancelled) return false
      setQueuedMessages({ steering: [], followUp: [] })
      await refreshAfterRun(generation)
      return generation === generationRef.current
    } catch (error) {
      if (generation === generationRef.current) setError(errorMessage(error))
      return false
    } finally {
      isChangingSessionRef.current = false
      if (generation === generationRef.current) setIsConnecting(false)
    }
  }, [getUnassignedWorkspace, refreshAfterRun, startSession])

  const disconnect = useCallback(async (): Promise<void> => {
    ++generationRef.current
    await window.piDesktop.stop()
    setIsRuntimeConnected(false)
    updateState(null)
    setMessages([])
    setToolExecutions({})
    setStats(null)
    setStatus(null)
    setIsRetrying(false)
    setRunningBash(null)
    setQueuedMessages({ steering: [], followUp: [] })
    setOptimisticUser(null)
    setExtensionRequest(null)
    setWidgets({})
    setCommandStatuses({})
    setUserEntryIds({})
  }, [updateState])

  const renameSession = useCallback(async (
    path: string,
    name: string,
    sourceProject: ProjectInfo
  ): Promise<boolean> => {
    const trimmed = name.trim()
    if (!trimmed) return false
    const generation = generationRef.current
    try {
      if (path === activeSessionRef.current && stateRef.current) {
        const response = await window.piDesktop.command({ type: 'set_session_name', name: trimmed })
        if (!response.success) throw new Error(response.error || '无法重命名会话。')
        await refreshAfterRun(generation)
      } else {
        await window.piDesktop.renameSessionFile(sourceProject.path, path, trimmed)
        await refreshSessions()
      }
      return true
    } catch (renameError) {
      setError(errorMessage(renameError))
      return false
    }
  }, [refreshAfterRun, refreshSessions])

  const trashSession = useCallback(async (path: string, sourceProject: ProjectInfo): Promise<boolean> => {
    if (isStartingRef.current || isChangingSessionRef.current) return false
    isChangingSessionRef.current = true
    try {
      if (path === activeSessionPath) await disconnect()
      await window.piDesktop.trashSession(sourceProject.path, path)
      setSessions((current) => current.filter((session) => session.path !== path))
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    } finally {
      isChangingSessionRef.current = false
    }
  }, [activeSessionPath, disconnect])

  const forgetProject = useCallback(async (path: string): Promise<void> => {
    if (path !== projectRef.current?.path) return
    const workspace = unassignedWorkspace ?? await getUnassignedWorkspace().catch(() => null)
    if (workspace) {
      await startSession(workspace)
      return
    }
    await disconnect()
    projectRef.current = null
    setProject(null)
    setSessions([])
    await connectIdle()
  }, [connectIdle, disconnect, getUnassignedWorkspace, startSession, unassignedWorkspace])

  async function changeSessionFile<T>(path: string, change: () => Promise<T>): Promise<T> {
    const active = path === activeSessionRef.current
    if (active && (isStreaming || isRetrying || runningBash || stateRef.current?.isStreaming)) {
      throw new Error('请在会话运行结束后重试。')
    }
    if (active) await disconnect()
    try {
      return await change()
    } catch (error) {
      if (active && projectRef.current) await startSession(projectRef.current, path)
      throw error
    }
  }

  async function moveSession(path: string, source: ProjectInfo, target: ProjectInfo): Promise<SessionSummary> {
    const active = path === activeSessionRef.current
    const session = await changeSessionFile(path, () => window.piDesktop.moveSession(source.path, path, target.path))
    if (active) await startSession(target, session.path)
    else await refreshSessions()
    return session
  }

  async function deleteSession(path: string, source: ProjectInfo): Promise<void> {
    await changeSessionFile(path, () => window.piDesktop.deleteSession(source.path, path))
    await refreshSessions()
  }

  const openSession = useCallback(
    async (path: string, sourceProject?: ProjectInfo): Promise<boolean> => {
      const currentProject = projectRef.current
      const targetProject = sourceProject ?? currentProject
      if (!targetProject) return false
      if (path === activeSessionPath && stateRef.current) return true
      if (!stateRef.current || targetProject.path !== currentProject?.path) {
        return startSession(targetProject, path)
      }
      const generation = generationRef.current
      if (stateRef.current?.isStreaming) {
        await window.piDesktop.command({ type: 'abort' })
      }
      const response = await window.piDesktop.command<{ cancelled?: boolean }>({
        type: 'switch_session',
        sessionPath: path
      })
      if (!response.success) {
        setError(response.error || '无法打开此会话。')
        return false
      }
      if (!response.data?.cancelled) {
        setQueuedMessages({ steering: [], followUp: [] })
        await refreshAfterRun(generation)
        return true
      }
      return false
    },
    [activeSessionPath, refreshAfterRun, startSession]
  )

  const compact = useCallback(async (customInstructions?: string): Promise<boolean> => {
    if (!stateRef.current) return false
    if (stateRef.current.isStreaming) {
      setError('当前正在运行中，请等待本轮结束或停止后再压缩上下文。')
      return false
    }
    const generation = generationRef.current
    setError(null)
    setStatus('正在压缩上下文…')
    const response = await window.piDesktop.command({
      type: 'compact',
      customInstructions
    })
    if (generation !== generationRef.current) return false
    if (!response.success) {
      setStatus(null)
      setError(response.error || '无法压缩上下文。')
      return false
    }
    await refreshAfterRun(generation)
    return true
  }, [refreshAfterRun])

  const runBash = useCallback(async (
    command: string,
    excludeFromContext = false
  ): Promise<boolean> => {
    const trimmed = command.trim()
    if (!trimmed || !stateRef.current) return false
    if (stateRef.current.isStreaming || runningBash) {
      setError('当前已有任务运行中，请等待完成后再执行 Bash 命令。')
      return false
    }
    const generation = generationRef.current
    setError(null)
    setRunningBash({ command: trimmed, output: '' })
    setStatus(`正在执行：$ ${trimmed}`)
    const response = await window.piDesktop.command<BashResult>({
      type: 'bash',
      command: trimmed,
      excludeFromContext
    })
    if (generation !== generationRef.current) return false
    setRunningBash(null)
    setStatus(null)
    if (!response.success) {
      setError(response.error || '执行 Bash 命令失败。')
      return false
    }
    await refreshAfterRun(generation)
    return true
  }, [refreshAfterRun, runningBash])

  const abortBash = useCallback(async (): Promise<void> => {
    const response = await window.piDesktop.command({ type: 'abort_bash' })
    if (!response.success) {
      setError(response.error || '无法中止 Bash 命令。')
    }
  }, [])

  const cloneSession = useCallback(async (): Promise<boolean> => {
    if (!stateRef.current) return false
    const generation = generationRef.current
    const response = await window.piDesktop.command<{ cancelled?: boolean }>({ type: 'clone' })
    if (generation !== generationRef.current) return false
    if (!response.success) {
      setError(response.error || '无法克隆当前会话。')
      return false
    }
    if (response.data?.cancelled) return false
    await refreshAfterRun(generation)
    setNotification({ status: 'success', message: '已克隆当前分支到新会话。' })
    return true
  }, [refreshAfterRun])

  const getForkMessages = useCallback(async (): Promise<ForkableMessage[]> => {
    if (!stateRef.current) return []
    const response = await window.piDesktop.command<{ messages: ForkableMessage[] }>({
      type: 'get_fork_messages'
    })
    if (!response.success) {
      throw new Error(response.error || '无法读取可分叉的消息列表。')
    }
    return response.data?.messages ?? []
  }, [])

  const forkToMessage = useCallback(async (
    entryId: string,
    successMessage: string
  ): Promise<boolean> => {
    if (!stateRef.current) return false
    const generation = generationRef.current
    const response = await window.piDesktop.command<{ text?: string; cancelled?: boolean }>({
      type: 'fork',
      entryId
    })
    if (generation !== generationRef.current) return false
    if (!response.success) {
      setError(response.error || '无法从该消息分叉会话。')
      return false
    }
    if (response.data?.cancelled) return false
    await refreshAfterRun(generation)
    if (typeof response.data?.text === 'string') {
      pushEditorPrefill(response.data.text)
    }
    setNotification({ status: 'success', message: successMessage })
    return true
  }, [pushEditorPrefill, refreshAfterRun])

  const forkSession = useCallback(
    (entryId: string) => forkToMessage(entryId, '已从所选消息分叉为新会话。'),
    [forkToMessage]
  )

  const retractUserMessage = useCallback(async (entryId: string): Promise<boolean> => {
    if (isStreaming || isRetrying) {
      setError('请等待当前任务结束后再撤回消息。')
      return false
    }
    return forkToMessage(entryId, '已撤回。原文已放回输入框。')
  }, [forkToMessage, isRetrying, isStreaming])

  const exportSessionHtml = useCallback(async (): Promise<void> => {
    if (!stateRef.current) return
    const defaultName = `${(stateRef.current.sessionName || 'pi-session').replace(/[/\\:*?"<>|]/g, '-')}.html`
    const outputPath = await window.piDesktop.chooseExportPath(defaultName)
    if (!outputPath) return
    const response = await window.piDesktop.command<{ path?: string }>({
      type: 'export_html',
      outputPath
    })
    if (!response.success) {
      setError(response.error || '导出会话 HTML 失败。')
      return
    }
    const savedPath = response.data?.path || outputPath
    setNotification({ status: 'success', message: `已导出会话：${savedPath}` })
    void window.piDesktop.revealFile(savedPath).catch(() => {})
  }, [])

  const copyLastAssistantText = useCallback(async (): Promise<void> => {
    if (!stateRef.current) return
    const response = await window.piDesktop.command<{ text: string | null }>({
      type: 'get_last_assistant_text'
    })
    if (!response.success) {
      setError(response.error || '无法获取最后一条回复。')
      return
    }
    const text = response.data?.text
    if (!text) {
      setNotification({ status: 'info', message: '当前会话暂无可复制的助手回复。' })
      return
    }
    await window.piDesktop.copyText(text)
    setNotification({ status: 'success', message: '已复制最后一条助手回复到剪贴板。' })
  }, [])

  const send = useCallback(async (
    text: string,
    images: ImageContent[] = []
  ): Promise<boolean> => {
    const trimmed = text.trim()
    if ((!trimmed && images.length === 0) || !stateRef.current) return false

    if (images.length === 0) {
      const compactMatch = trimmed.match(/^\/compact(?:\s+([\s\S]*))?$/)
      if (compactMatch) return compact(compactMatch[1]?.trim() || undefined)

      if (trimmed === '/new') return newSession()

      const nameMatch = trimmed.match(/^\/name\s+([\s\S]+)$/)
      if (nameMatch && activeSessionRef.current && projectRef.current) {
        return renameSession(activeSessionRef.current, nameMatch[1].trim(), projectRef.current)
      }

      if (trimmed === '/clone') return cloneSession()
      if (trimmed === '/copy') {
        await copyLastAssistantText()
        return true
      }
      if (trimmed === '/export') {
        await exportSessionHtml()
        return true
      }

      if (trimmed.startsWith('!')) {
        const excludeFromContext = trimmed.startsWith('!!')
        const bashCmd = trimmed.slice(excludeFromContext ? 2 : 1).trim()
        if (bashCmd) return runBash(bashCmd, excludeFromContext)
      }
    }

    setOptimisticUser({ text: trimmed, images })
    setError(null)
    const response = await window.piDesktop.command({
      type: 'prompt',
      message: trimmed,
      ...(images.length > 0 ? { images } : {}),
      streamingBehavior: stateRef.current.isStreaming ? streamingBehavior : undefined
    })

    if (!response.success) {
      setOptimisticUser(null)
      setError(response.error || 'Pi 未能接收此消息。')
      return false
    }

    setIsStreaming(true)
    return true
  }, [
    cloneSession,
    compact,
    copyLastAssistantText,
    exportSessionHtml,
    newSession,
    renameSession,
    runBash,
    streamingBehavior
  ])

  const stop = useCallback(async (): Promise<void> => {
    if (runningBash) {
      await abortBash()
      return
    }
    const response = await window.piDesktop.command({ type: 'abort' })
    if (!response.success) {
      setError(response.error || '无法停止当前任务。')
    }
  }, [abortBash, runningBash])

  const clearQueue = useCallback(async (): Promise<string[]> => {
    const response = await window.piDesktop.command<{ steering: string[]; followUp: string[] }>({
      type: 'clear_queue'
    })
    if (!response.success) {
      setError(response.error || '无法清空排队消息。')
      return []
    }
    const restored = [
      ...(response.data?.steering ?? []),
      ...(response.data?.followUp ?? [])
    ]
    setQueuedMessages({ steering: [], followUp: [] })
    if (restored.length > 0) {
      pushEditorPrefill(restored.join('\n'))
    }
    return restored
  }, [pushEditorPrefill])

  const abortRetry = useCallback(async (): Promise<void> => {
    const response = await window.piDesktop.command({ type: 'abort_retry' })
    if (!response.success) {
      setError(response.error || '无法取消自动重试。')
      return
    }
    setIsRetrying(false)
    setStatus(null)
  }, [])

  const updateSessionSetting = useCallback(async (
    cmd:
      | { type: 'set_steering_mode'; mode: 'all' | 'one-at-a-time' }
      | { type: 'set_follow_up_mode'; mode: 'all' | 'one-at-a-time' }
      | { type: 'set_auto_compaction'; enabled: boolean }
      | { type: 'set_auto_retry'; enabled: boolean }
  ): Promise<void> => {
    const generation = generationRef.current
    const response = await window.piDesktop.command(cmd)
    if (generation !== generationRef.current) return
    if (!response.success) {
      setError(response.error || '无法更新会话设置。')
      return
    }
    if (cmd.type === 'set_auto_retry') {
      setAutoRetryEnabled(cmd.enabled)
    }
    const current = await window.piDesktop.command<PiSessionState>({ type: 'get_state' })
    if (generation === generationRef.current && current.success && current.data) {
      updateState(current.data)
    }
  }, [updateState])

  const setModel = useCallback(
    async (provider: string, modelId: string): Promise<void> => {
      const generation = generationRef.current
      const response = await window.piDesktop.command({
        type: 'set_model',
        provider,
        modelId
      })
      if (generation !== generationRef.current) return
      if (!response.success) {
        setError(response.error || '无法切换模型。')
        return
      }
      const current = await window.piDesktop.command<PiSessionState>({ type: 'get_state' })
      if (generation !== generationRef.current) return
      if (current.success && current.data) updateState(current.data)
      setStats(null)
      await refreshStats(generation)
    },
    [refreshStats, updateState]
  )

  const setThinkingLevel = useCallback(
    async (level: ThinkingLevel): Promise<void> => {
      const generation = generationRef.current
      const response = await window.piDesktop.command({
        type: 'set_thinking_level',
        level
      })
      if (generation !== generationRef.current) return
      if (!response.success) {
        setError(response.error || '无法调整思考强度。')
        return
      }
      const current = await window.piDesktop.command<PiSessionState>({ type: 'get_state' })
      if (generation === generationRef.current && current.success && current.data) {
        updateState(current.data)
      }
    },
    [updateState]
  )

  const respondToExtension = useCallback(
    async (response: ExtensionUiResponse): Promise<void> => {
      await window.piDesktop.command({
        ...response,
        type: 'extension_ui_response'
      })
      setExtensionRequest(null)
    },
    []
  )

  useEffect(() => {
    const unsubscribe = window.piDesktop.onEvent((event: HostEvent) => {
      const generation = generationRef.current

      switch (event.type) {
        case 'agent_start':
          setIsStreaming(true)
          setStatus('运行中…')
          break
        case 'agent_end':
          setIsStreaming(false)
          setStatus(null)
          void refreshAfterRun(generation)
          break
        case 'agent_settled':
          setIsStreaming(false)
          setIsRetrying(false)
          setStatus(null)
          break
        case 'message_start':
        case 'message_end':
          setMessages((current) => upsertMessage(current, event.message))
          if (event.message.role === 'user') setOptimisticUser(null)
          break
        case 'message_update':
          setMessages((current) =>
            applyAssistantMessageUpdate(current, event.assistantMessageEvent)
          )
          break
        case 'turn_end':
          void refreshStats(generation)
          for (const result of event.toolResults) {
            setMessages((current) => upsertMessage(current, result))
            setToolExecutions((current) => ({
              ...current,
              [result.toolCallId]: {
                ...(current[result.toolCallId] ?? {
                  toolCallId: result.toolCallId,
                  toolName: result.toolName,
                  args: {},
                  startedAt: result.timestamp
                }),
                output: contentToText(result.content),
                isError: result.isError,
                isRunning: false
              }
            }))
          }
          break
        case 'tool_execution_start':
          setToolExecutions((current) => ({
            ...current,
            [event.toolCallId]: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              output: '',
              isRunning: true,
              startedAt: Date.now()
            }
          }))
          break
        case 'tool_execution_update':
          setToolExecutions((current) => {
            const existing = current[event.toolCallId]
            if (!existing) return current
            return {
              ...current,
              [event.toolCallId]: {
                ...existing,
                output: contentToText(event.partialResult.content),
                isRunning: true
              }
            }
          })
          break
        case 'tool_execution_end':
          setToolExecutions((current) => {
            const existing = current[event.toolCallId]
            return {
              ...current,
              [event.toolCallId]: {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: existing?.args ?? {},
                output: contentToText(event.result.content),
                isError: event.isError,
                isRunning: false,
                startedAt: existing?.startedAt ?? Date.now(),
                duration: Date.now() - (existing?.startedAt ?? Date.now())
              }
            }
          })
          break
        case 'bash_execution_update':
          setRunningBash((current) =>
            current ? { ...current, output: `${current.output}${event.delta}` } : current
          )
          break
        case 'queue_update': {
          setQueuedMessages({ steering: event.steering, followUp: event.followUp })
          const count = event.steering.length + event.followUp.length
          if (count > 0) {
            setStatus(`有 ${count} 条消息排队中`)
          } else if (stateRef.current?.isStreaming) {
            setStatus('运行中…')
          }
          break
        }
        case 'session_info_changed':
          if (stateRef.current) {
            updateState({ ...stateRef.current, sessionName: event.name })
          }
          void refreshSessions()
          break
        case 'thinking_level_changed':
          if (stateRef.current) {
            updateState({ ...stateRef.current, thinkingLevel: event.level })
          }
          break
        case 'compaction_start':
          setStatus('正在压缩上下文…')
          break
        case 'compaction_end':
          void refreshStats(generation)
          setStatus(null)
          if (event.errorMessage) setError(event.errorMessage)
          break
        case 'auto_retry_start':
          setIsRetrying(true)
          setStatus(
            `${Math.ceil(event.delayMs / 1000)} 秒后重试（${event.attempt}/${event.maxAttempts}）…`
          )
          break
        case 'auto_retry_end':
          setIsRetrying(false)
          setStatus(null)
          if (!event.success && event.finalError) setError(event.finalError)
          break
        case 'extension_error':
          setError(event.error)
          break
        case 'extension_ui_request': {
          const method = event.method
          if (
            method === 'select' ||
            method === 'confirm' ||
            method === 'input' ||
            method === 'editor'
          ) {
            setExtensionRequest({
              id: event.id,
              method,
              title: typeof event.title === 'string' ? event.title : 'Pi 需要你的输入',
              message: typeof event.message === 'string' ? event.message : undefined,
              options: Array.isArray(event.options)
                ? event.options.filter((option): option is string => typeof option === 'string')
                : undefined,
              placeholder: typeof event.placeholder === 'string' ? event.placeholder : undefined,
              prefill: typeof event.prefill === 'string' ? event.prefill : undefined
            })
            break
          }
          if (method === 'notify') {
            const notifyType = typeof event.notifyType === 'string' ? event.notifyType : 'info'
            const status =
              notifyType === 'error' || notifyType === 'warning' || notifyType === 'success'
                ? notifyType
                : 'info'
            setNotification({
              status,
              message: typeof event.message === 'string' ? event.message : 'Pi 通知'
            })
            break
          }
          if (method === 'setStatus') {
            const key = typeof event.statusKey === 'string' ? event.statusKey : 'pi'
            const text = typeof event.statusText === 'string' ? event.statusText : ''
            setCommandStatuses((current) => {
              const next = { ...current }
              if (text) next[key] = text
              else delete next[key]
              return next
            })
            break
          }
          if (method === 'setWidget') {
            const key = typeof event.widgetKey === 'string' ? event.widgetKey : 'pi'
            const lines = Array.isArray(event.widgetLines)
              ? event.widgetLines.filter((line): line is string => typeof line === 'string')
              : null
            const placement = event.widgetPlacement === 'belowEditor' ? 'belowEditor' : 'aboveEditor'
            setWidgets((current) => {
              const next = { ...current }
              if (lines && lines.length > 0) next[key] = { lines, placement }
              else delete next[key]
              return next
            })
            break
          }
          if (method === 'setTitle' && typeof event.title === 'string') {
            void window.piDesktop.setWindowTitle(event.title)
            break
          }
          if (method === 'set_editor_text' && typeof event.text === 'string') {
            pushEditorPrefill(event.text)
          }
          break
        }
        default: {
          if ((event as { type: string }).type === 'host_error') {
            setError((event as { error: string }).error)
            setIsRuntimeConnected(false)
            updateState(null)
            setStatus(null)
            setIsRetrying(false)
            setRunningBash(null)
          }
        }
      }
    })

    return unsubscribe
  }, [pushEditorPrefill, refreshAfterRun, refreshSessions, refreshStats, updateState])

  useEffect(() => {
    if (didConnectOnLaunch.current) return
    didConnectOnLaunch.current = true
    void (async () => {
      try {
        const workspace = await getUnassignedWorkspace()
        await startSession(workspace)
      } catch (launchError) {
        setError(errorMessage(launchError))
        setIsConnecting(false)
      }
    })()
  }, [getUnassignedWorkspace, startSession])

  return {
    project,
    unassignedWorkspace,
    sessions,
    state,
    messages,
    models,
    stats,
    commands,
    toolExecutions,
    isStreaming,
    isBashRunning: Boolean(runningBash),
    runningBash,
    isConnecting,
    isRuntimeConnected,
    isRetrying,
    streamingBehavior,
    autoRetryEnabled,
    queuedMessages,
    reconnect,
    activeSessionPath,
    optimisticUser,
    error,
    notification,
    status,
    extensionRequest,
    commandStatuses,
    widgets,
    editorPrefill,
    userEntryIds,
    newSession,
    renameSession,
    trashSession,
    moveSession,
    deleteSession,
    forgetProject,
    reportError: (error) => setError(errorMessage(error)),
    openSession,
    send,
    runBash,
    abortBash,
    compact,
    clearQueue,
    abortRetry,
    setStreamingBehavior,
    setSteeringMode: (mode) => updateSessionSetting({ type: 'set_steering_mode', mode }),
    setFollowUpMode: (mode) => updateSessionSetting({ type: 'set_follow_up_mode', mode }),
    setAutoCompaction: (enabled) => updateSessionSetting({ type: 'set_auto_compaction', enabled }),
    setAutoRetry: (enabled) => updateSessionSetting({ type: 'set_auto_retry', enabled }),
    getForkMessages,
    forkSession,
    retractUserMessage,
    cloneSession,
    exportSessionHtml,
    copyLastAssistantText,
    stop,
    setModel,
    setThinkingLevel,
    respondToExtension,
    dismissError: () => setError(null),
    dismissNotification: () => setNotification(null),
    refreshSessions
  }
}

export type { ContentBlock }
