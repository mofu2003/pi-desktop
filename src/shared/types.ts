export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; redacted?: boolean }
  | {
      type: 'toolCall'
      id: string
      name: string
      arguments: Record<string, unknown>
    }
  | { type: 'image'; data: string; mimeType: string }

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

export interface AssistantMessage {
  role: 'assistant'
  content: ContentBlock[]
  api?: string
  provider?: string
  model?: string
  responseModel?: string
  usage?: AgentUsage
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  errorMessage?: string
  timestamp: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: ContentBlock[]
  details?: unknown
  isError: boolean
  timestamp: number
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
  contextWindow?: number
  maxTokens?: number
}

export interface PiSessionState {
  model?: PiModel
  thinkingLevel: ThinkingLevel
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
  | { type: 'turn_start' }
  | {
      type: 'turn_end'
      message: AgentMessage
      toolResults: ToolResultMessage[]
    }
  | { type: 'message_start'; message: AgentMessage }
  | {
      type: 'message_update'
      message: AgentMessage
      assistantMessageEvent: {
        type: string
        delta?: string
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

export interface ProjectInfo {
  path: string
  name: string
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

export interface StartOptions {
  cwd: string
  sessionPath?: string
}

export interface BootstrapPayload {
  cwd: string
  piPath: string
  state: PiSessionState
  messages: AgentMessage[]
  models: PiModel[]
  stats?: PiSessionStats
  commands: PiCommandInfo[]
}

export type PiCommand =
  | { type: 'prompt'; message: string; streamingBehavior?: 'steer' | 'followUp' }
  | { type: 'steer'; message: string }
  | { type: 'follow_up'; message: string }
  | { type: 'abort' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'get_state' }
  | { type: 'get_messages' }
  | { type: 'get_available_models' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'set_session_name'; name: string }
  | { type: 'get_session_stats' }
  | { type: 'switch_session'; sessionPath: string }
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

export interface PiDesktopApi {
  chooseProject: () => Promise<ProjectInfo | null>
  listSessions: (cwd: string) => Promise<SessionSummary[]>
  start: (options: StartOptions) => Promise<BootstrapPayload>
  command: <T = unknown>(
    command: PiCommand
  ) => Promise<{ success: boolean; data?: T; error?: string }>
  stop: () => Promise<void>
  onEvent: (listener: (event: PiEvent) => void) => () => void
  onMenuNewSession: (listener: () => void) => () => void
  platform: NodeJS.Platform
}
