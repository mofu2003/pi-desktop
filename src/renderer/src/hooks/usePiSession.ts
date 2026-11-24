import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentMessage,
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
  contentToText,
  messageKey,
  toolResultMap,
  upsertMessage
} from '../lib/pi'

const LAST_PROJECT_KEY = 'pi-desktop:last-project'

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

export interface ComposerStatus {
  type: 'error' | 'warning'
  message?: string
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

interface UsePiSessionResult {
  project: ProjectInfo | null
  sessions: SessionSummary[]
  state: PiSessionState | null
  messages: AgentMessage[]
  models: PiModel[]
  stats: PiSessionStats | null
  commands: PiCommandInfo[]
  toolExecutions: Record<string, ToolExecution>
  isStreaming: boolean
  isConnecting: boolean
  activeSessionPath?: string
  optimisticUser: string | null
  error: string | null
  notification: PiNotification | null
  status: string | null
  extensionRequest: ExtensionRequest | null
  commandStatuses: Record<string, string>
  chooseProject: () => Promise<boolean>
  openProject: (path: string) => Promise<void>
  newSession: () => Promise<boolean>
  openSession: (path: string, sourceProject?: ProjectInfo) => Promise<void>
  send: (text: string) => Promise<boolean>
  stop: () => Promise<void>
  setModel: (provider: string, modelId: string) => Promise<void>
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>
  respondToExtension: (
    response: ExtensionUiResponse
  ) => Promise<void>
  dismissError: () => void
  dismissNotification: () => void
  refreshSessions: () => Promise<void>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '与 Pi 通信时发生错误。'
}

function readLastProject(): ProjectInfo | null {
  try {
    const raw = localStorage.getItem(LAST_PROJECT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectInfo
    return parsed.path ? parsed : null
  } catch {
    return null
  }
}

export function usePiSession(): UsePiSessionResult {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [state, setState] = useState<PiSessionState | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [models, setModels] = useState<PiModel[]>([])
  const [stats, setStats] = useState<PiSessionStats | null>(null)
  const [commands, setCommands] = useState<PiCommandInfo[]>([])
  const [toolExecutions, setToolExecutions] = useState<
    Record<string, ToolExecution>
  >({})
  const [isStreaming, setIsStreaming] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [activeSessionPath, setActiveSessionPath] = useState<string>()
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<PiNotification | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [extensionRequest, setExtensionRequest] =
    useState<ExtensionRequest | null>(null)
  const [commandStatuses, setCommandStatuses] = useState<Record<string, string>>(
    {}
  )

  const stateRef = useRef<PiSessionState | null>(null)
  const projectRef = useRef<ProjectInfo | null>(null)
  const generationRef = useRef(0)
  const statsRequestRef = useRef(0)

  const updateState = useCallback((next: PiSessionState | null): void => {
    stateRef.current = next
    setState(next)
    setIsStreaming(Boolean(next?.isStreaming))
  }, [])

  const refreshSessions = useCallback(async (): Promise<void> => {
    const currentProject = projectRef.current
    if (!currentProject) {
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
    const [stateResult, messagesResult, sessionsResult] =
      await Promise.all([
        window.piDesktop.command<PiSessionState>({ type: 'get_state' }),
        window.piDesktop.command<{ messages: AgentMessage[] }>({
          type: 'get_messages'
        }),
        projectRef.current
          ? window.piDesktop.listSessions(projectRef.current.path)
          : Promise.resolve([]),
        refreshStats(generation)
      ])

    if (generation !== generationRef.current) return
    if (stateResult.success && stateResult.data) updateState(stateResult.data)
    if (messagesResult.success && messagesResult.data) {
      setMessages(messagesResult.data.messages)
      setToolExecutions(toolResultMap(messagesResult.data.messages))
    }
    if (stateResult.success && stateResult.data) {
      setActiveSessionPath(stateResult.data.sessionFile)
    }
    setSessions(sessionsResult)
    setOptimisticUser(null)
    setStatus(null)
  }, [refreshStats, updateState])

  const startSession = useCallback(
    async (
      selectedProject: ProjectInfo,
      sessionPath?: string
    ): Promise<boolean> => {
      const generation = ++generationRef.current
      setProject(selectedProject)
      projectRef.current = selectedProject
      localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify(selectedProject))
      setIsConnecting(true)
      setError(null)
      setStatus(null)
      setOptimisticUser(null)
      updateState(null)
      setStats(null)
      setMessages([])
      setSessions([])
      setToolExecutions({})
      setActiveSessionPath(sessionPath)

      try {
        const payload = await window.piDesktop.start({
          cwd: selectedProject.path,
          sessionPath
        })
        if (generation !== generationRef.current) return false

        updateState(payload.state)
        setMessages(payload.messages)
        setToolExecutions(toolResultMap(payload.messages))
        setModels(payload.models)
        setStats(payload.stats ?? null)
        setCommands(payload.commands)
        setActiveSessionPath(payload.state.sessionFile ?? sessionPath)
        const projectSessions = await window.piDesktop.listSessions(selectedProject.path)
        if (generation !== generationRef.current) return false
        setSessions(projectSessions)
        return true
      } catch (startError) {
        if (generation === generationRef.current) setError(errorMessage(startError))
        return false
      } finally {
        if (generation === generationRef.current) setIsConnecting(false)
      }
    },
    [updateState]
  )

  const chooseProject = useCallback(async (): Promise<boolean> => {
    const selected = await window.piDesktop.chooseProject()
    if (!selected) return false
    return startSession(selected)
  }, [startSession])

  const openProject = useCallback(
    async (path: string): Promise<void> => {
      await startSession({
        path,
        name: path.split('/').filter(Boolean).at(-1) || path
      })
    },
    [startSession]
  )

  const newSession = useCallback(async (): Promise<boolean> => {
    const currentProject = projectRef.current
    if (!currentProject) return false
    if (!stateRef.current) return startSession(currentProject)
    const generation = generationRef.current
    if (stateRef.current?.isStreaming) {
      await window.piDesktop.command({ type: 'abort' })
    }
    const response = await window.piDesktop.command<{ cancelled?: boolean }>({
      type: 'new_session'
    })
    if (!response.success) {
      setError(response.error || '无法新建会话。')
      return false
    }
    if (response.data?.cancelled) return false
    await refreshAfterRun(generation)
    return generation === generationRef.current
  }, [refreshAfterRun, startSession])

  const openSession = useCallback(
    async (path: string, sourceProject?: ProjectInfo): Promise<void> => {
      const currentProject = projectRef.current
      const targetProject = sourceProject ?? currentProject
      if (!targetProject || path === activeSessionPath) return
      if (!stateRef.current || targetProject.path !== currentProject?.path) {
        await startSession(targetProject, path)
        return
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
        return
      }
      if (!response.data?.cancelled) {
        await refreshAfterRun(generation)
      }
    },
    [activeSessionPath, refreshAfterRun, startSession]
  )

  const send = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (!trimmed || !stateRef.current) return false

    setOptimisticUser(trimmed)
    setError(null)
    const response = await window.piDesktop.command({
      type: 'prompt',
      message: trimmed,
      streamingBehavior: stateRef.current.isStreaming ? 'steer' : undefined
    })

    if (!response.success) {
      setOptimisticUser(null)
        setError(response.error || 'Pi 未能接收此消息。')
      return false
    }

    setIsStreaming(true)
    return true
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    const response = await window.piDesktop.command({ type: 'abort' })
    if (!response.success) {
      setError(response.error || '无法停止当前任务。')
    }
  }, [])

  const setModel = useCallback(
    async (provider: string, modelId: string): Promise<void> => {
      const generation = generationRef.current
      const response = await window.piDesktop.command<PiModel>({
        type: 'set_model',
        provider,
        modelId
      })
      if (generation !== generationRef.current) return
      if (!response.success) {
        setError(response.error || '无法切换模型。')
        return
      }
      if (response.data) {
        updateState(
          stateRef.current
            ? { ...stateRef.current, model: response.data }
            : null
        )
      }
      setStats(null)
      await refreshStats(generation)
    },
    [refreshStats, updateState]
  )

  const setThinkingLevel = useCallback(
    async (level: ThinkingLevel): Promise<void> => {
      const response = await window.piDesktop.command({
        type: 'set_thinking_level',
        level
      })
      if (!response.success) {
        setError(response.error || '无法调整思考强度。')
        return
      }
      updateState(
        stateRef.current
          ? { ...stateRef.current, thinkingLevel: level }
          : null
      )
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
    const lastProject = readLastProject()
    if (!lastProject) return
    setProject(lastProject)
    projectRef.current = lastProject
    const generation = generationRef.current
    void (async () => {
      try {
        const restoredSessions = await window.piDesktop.listSessions(lastProject.path)
        if (generation === generationRef.current) setSessions(restoredSessions)
      } catch (sessionError) {
        if (generation === generationRef.current) setError(errorMessage(sessionError))
      }
    })()
  }, [])

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
        case 'message_start':
        case 'message_update':
        case 'message_end':
          setMessages((current) => upsertMessage(current, event.message))
          if (event.message.role === 'user') setOptimisticUser(null)
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
        case 'queue_update':
          if (event.steering.length + event.followUp.length > 0) {
            setStatus(
              `有 ${event.steering.length + event.followUp.length} 条消息排队中`
            )
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
          setStatus(
            `${Math.ceil(
              event.delayMs / 1000
            )} 秒后重试（${event.attempt}/${event.maxAttempts}）…`
          )
          break
        case 'auto_retry_end':
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
              title:
                typeof event.title === 'string' ? event.title : 'Pi 需要你的输入',
              message:
                typeof event.message === 'string' ? event.message : undefined,
              options: Array.isArray(event.options)
                ? event.options.filter(
                    (option): option is string => typeof option === 'string'
                  )
                : undefined,
              placeholder:
                typeof event.placeholder === 'string'
                  ? event.placeholder
                  : undefined,
              prefill:
                typeof event.prefill === 'string' ? event.prefill : undefined
            })
            break
          }
          if (method === 'notify') {
            const notifyType =
              typeof event.notifyType === 'string'
                ? event.notifyType
                : 'info'
            const status =
              notifyType === 'error' ||
              notifyType === 'warning' ||
              notifyType === 'success'
                ? notifyType
                : 'info'
            setNotification({
              status,
              message:
                typeof event.message === 'string' ? event.message : 'Pi 通知'
            })
            break
          }
          if (method === 'setStatus') {
            const key =
              typeof event.statusKey === 'string' ? event.statusKey : 'pi'
            const text =
              typeof event.statusText === 'string' ? event.statusText : ''
            setCommandStatuses((current) => {
              const next = { ...current }
              if (text) next[key] = text
              else delete next[key]
              return next
            })
          }
          break
        }
        default: {
          if ((event as { type: string }).type === 'host_error') {
            setError((event as { error: string }).error)
            setIsStreaming(false)
            setStatus(null)
          }
        }
      }
    })

    return unsubscribe
  }, [refreshAfterRun, refreshStats])

  return {
    project,
    sessions,
    state,
    messages,
    models,
    stats,
    commands,
    toolExecutions,
    isStreaming,
    isConnecting,
    activeSessionPath,
    optimisticUser,
    error,
    notification,
    status,
    extensionRequest,
    commandStatuses,
    chooseProject,
    openProject,
    newSession,
    openSession,
    send,
    stop,
    setModel,
    setThinkingLevel,
    respondToExtension,
    dismissError: () => setError(null),
    dismissNotification: () => setNotification(null),
    refreshSessions
  }
}
