export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; redacted?: boolean }
  | {
      type: 'toolCall'
      id: string
      name: string
      arguments: Record<string, unknown>
    }
  | ImageContent

export interface AgentUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export interface UserMessage {
  role: 'user'
  content: string | ContentBlock[]
  timestamp: number
}

export interface SystemMessage {
  role: 'system'
  content: string | ContentBlock[]
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: ContentBlock[]
  api?: string
  provider?: string
  model?: string
  responseModel?: string
  usage?: AgentUsage
  stopReason?:
    | 'pending'
    | 'stop'
    | 'length'
    | 'toolUse'
    | 'error'
    | 'aborted'
    | 'deferred'
  errorMessage?: string
  timestamp: number
  durationMs?: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: ContentBlock[]
  details?: unknown
  isError: boolean
  timestamp: number
  durationMs?: number
}

export interface BashExecutionMessage {
  role: 'bashExecution'
  command: string
  output: string
  exitCode?: number
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string
  excludeFromContext?: boolean
  timestamp: number
}

export interface CustomMessage {
  role: 'custom'
  customType: string
  content: string | ContentBlock[]
  display: boolean
  details?: unknown
  timestamp: number
}

export interface BranchSummaryMessage {
  role: 'branchSummary'
  summary: string
  fromId: string
  timestamp: number
}

export interface CompactionSummaryMessage {
  role: 'compactionSummary'
  summary: string
  tokensBefore: number
  timestamp: number
}

export type AgentMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage

export interface PiModel {
  id: string
  name?: string
  provider: string
  api?: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
  contextWindow?: number
  maxTokens?: number
}

export interface PiSessionState {
  model?: PiModel
  thinkingLevel: ThinkingLevel
  availableThinkingLevels?: ThinkingLevel[]
  isStreaming: boolean
  isCompacting: boolean
  steeringMode: 'all' | 'one-at-a-time'
  followUpMode: 'all' | 'one-at-a-time'
  sessionFile?: string
  sessionId: string
  sessionName?: string
  autoCompactionEnabled: boolean
  messageCount: number
  pendingMessageCount: number
}

export interface PiSessionStats {
  sessionFile?: string
  sessionId: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
  contextUsage?: {
    tokens: number | null
    contextWindow: number
    percent: number | null
  }
}

export interface PiCommandInfo {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  sourceInfo?: unknown
}

export interface ToolExecution {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  output: string
  isError?: boolean
  isRunning: boolean
  duration?: number
  startedAt: number
}

export type PiEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'agent_settled'; aborted: boolean }
  | { type: 'turn_start' }
  | {
      type: 'turn_end'
      message: AgentMessage
      toolResults: ToolResultMessage[]
    }
  | { type: 'message_start'; message: AgentMessage }
  | {
      type: 'message_update'
      usage?: AgentUsage
      assistantMessageEvent: {
        type: string
        contentIndex?: number
        delta?: string
        content?: string
        id?: string
        toolName?: string
        toolCall?: ContentBlock
        reason?: string
        [key: string]: unknown
      }
    }
  | { type: 'message_end'; message: AgentMessage }
  | {
      type: 'tool_execution_start'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool_execution_update'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
      partialResult: { content?: ContentBlock[]; details?: unknown }
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result: { content?: ContentBlock[]; details?: unknown }
      isError: boolean
    }
  | {
      type: 'queue_update'
      steering: string[]
      followUp: string[]
    }
  | { type: 'compaction_start'; reason: string }
  | {
      type: 'compaction_end'
      reason: string
      result?: unknown
      aborted: boolean
      willRetry: boolean
      errorMessage?: string
    }
  | {
      type: 'auto_retry_start'
      attempt: number
      maxAttempts: number
      delayMs: number
      errorMessage: string
    }
  | {
      type: 'auto_retry_end'
      success: boolean
      attempt: number
      finalError?: string
    }
  | {
      type: 'extension_error'
      extensionPath?: string
      event?: string
      error: string
    }
  | {
      type: 'extension_ui_request'
      id: string
      method: string
      [key: string]: unknown
    }
  | {
      type: 'bash_execution_update'
      id?: string
      delta: string
    }
  | {
      type: 'session_info_changed'
      name?: string
    }
  | {
      type: 'thinking_level_changed'
      level: ThinkingLevel
    }
  | {
      type: 'agent_settled'
      aborted: boolean
    }

export interface SshHostInfo {
  name: string
  hostName?: string
  user?: string
  port?: number
  source: 'config' | 'custom'
}

export interface SshTarget {
  host: string
  label?: string
  remoteCwd?: string
  port?: number
}

export interface ProjectInfo {
  path: string
  name: string
  isUnassigned?: true
  ssh?: SshTarget
}

export interface SessionSummary {
  id: string
  path: string
  cwd: string
  name?: string
  title: string
  preview: string
  messageCount: number
  created: string
  modified: string
}

export interface SessionListOptions {
  retainPaths?: string[]
  excludePaths?: string[]
  includeAll?: boolean
}

export interface StartOptions {
  cwd: string
  sessionPath?: string
  ssh?: SshTarget
}

export interface AvailableUpdate {
  version: string
  downloadUrl: string
  sha256?: string
  size?: number
}

export type UpdateStatus =
  | { status: 'current' }
  | { status: 'unavailable'; version: string }
  | ({ status: 'available' } & AvailableUpdate)

export interface BootstrapPayload {
  cwd: string
  piPath: string
  ssh?: SshTarget
  state: PiSessionState
  messages: AgentMessage[]
  models: PiModel[]
  stats?: PiSessionStats
  commands: PiCommandInfo[]
}

export interface ForkableMessage {
  entryId: string
  text: string
}

export interface BashResult {
  output: string
  exitCode?: number
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string
}

export type PiCommand =
  | {
      type: 'prompt'
      message: string
      images?: ImageContent[]
      streamingBehavior?: 'steer' | 'followUp'
    }
  | { type: 'steer'; message: string; images?: ImageContent[] }
  | { type: 'follow_up'; message: string; images?: ImageContent[] }
  | { type: 'abort' }
  | { type: 'clear_queue' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'get_state' }
  | { type: 'get_available_thinking_levels' }
  | { type: 'get_messages' }
  | { type: 'get_available_models' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'cycle_model' }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'cycle_thinking_level' }
  | { type: 'set_steering_mode'; mode: 'all' | 'one-at-a-time' }
  | { type: 'set_follow_up_mode'; mode: 'all' | 'one-at-a-time' }
  | { type: 'set_auto_compaction'; enabled: boolean }
  | { type: 'set_auto_retry'; enabled: boolean }
  | { type: 'abort_retry' }
  | { type: 'bash'; command: string; excludeFromContext?: boolean }
  | { type: 'abort_bash' }
  | { type: 'set_session_name'; name: string }
  | { type: 'get_session_stats' }
  | { type: 'export_html'; outputPath?: string }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'fork'; entryId: string }
  | { type: 'clone' }
  | { type: 'get_fork_messages' }
  | { type: 'get_entries'; since?: string }
  | { type: 'get_tree' }
  | { type: 'get_last_assistant_text' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'get_commands' }
  | {
      type: 'extension_ui_response'
      id: string
      value?: string
      confirmed?: boolean
      cancelled?: boolean
    }

export interface PiResponse<T = unknown> {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: T
  error?: string
}

export interface CustomizationResource {
  id: string
  kind: 'skills' | 'mcp' | 'extensions'
  scope: 'user' | 'project'
  name: string
  description?: string
}

export interface CustomizationDetail {
  files: string[]
  mcp?: {
    description?: string
    enabled?: boolean
    exposure?: string
    rules: { pattern: string; exposure: string }[]
  }
}

export interface PiDesktopApi {
  listCustomization: (cwd?: string) => Promise<CustomizationResource[]>
  revealCustomization: (id: string) => Promise<boolean>
  getCustomizationDetail: (id: string) => Promise<CustomizationDetail>
  readCustomizationFile: (id: string, file: string) => Promise<string>
  chooseProjectFolder: () => Promise<ProjectInfo | null>
  chooseImages: () => Promise<ImageContent[]>
  createProject: (name: string, sourceFolder?: string) => Promise<ProjectInfo>
  getUnassignedWorkspace: () => Promise<ProjectInfo>
  listSshHosts: () => Promise<SshHostInfo[]>
  revealProject: (cwd: string) => Promise<void>
  listSessions: (cwd: string, options?: SessionListOptions) => Promise<SessionSummary[]>
  moveSession: (cwd: string, path: string, target: string) => Promise<SessionSummary>
  copySessionMarkdown: (cwd: string, path: string) => Promise<void>
  shareSession: (cwd: string, path: string) => Promise<void>
  openSessionPreview: (cwd: string, path: string, title: string) => Promise<void>
  getSessionPreview: () => Promise<{ title: string; markdown: string } | undefined>
  takeSessionLink: () => Promise<SessionSummary | undefined>
  onSessionLink: (listener: () => void) => () => void
  forkSessionInWorktree: (cwd: string, path: string) => Promise<{ session: SessionSummary; project: ProjectInfo }>
  deleteSession: (cwd: string, path: string) => Promise<void>
  renameSessionFile: (cwd: string, path: string, name: string) => Promise<void>
  trashSession: (cwd: string, path: string) => Promise<void>
  chooseExportPath: (defaultName: string) => Promise<string | null>
  revealFile: (path: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  setWindowTitle: (title: string) => Promise<void>
  connect: () => Promise<void>
  start: (options: StartOptions) => Promise<BootstrapPayload>
  command: <T = unknown>(
    command: PiCommand
  ) => Promise<{ success: boolean; data?: T; error?: string }>
  stop: () => Promise<void>
  onEvent: (listener: (event: PiEvent) => void) => () => void
  onMenuNewSession: (listener: () => void) => () => void
  onMenuToggleSidebar: (listener: () => void) => () => void
  getUpdate: () => Promise<AvailableUpdate | null>
  openUpdate: () => Promise<boolean>
  onUpdateAvailable: (listener: (update: AvailableUpdate) => void) => () => void
  platform: NodeJS.Platform
}
