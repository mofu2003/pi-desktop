import type {
  AgentMessage,
  ContentBlock,
  PiModel,
  ToolExecution
} from '../../../shared/types'

export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as ContentBlock[])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

export function messageText(message: AgentMessage): string {
  if (
    message.role === 'user' ||
    message.role === 'assistant' ||
    message.role === 'custom'
  ) {
    return contentToText(message.content)
  }
  if (message.role === 'bashExecution') return message.output
  if (message.role === 'branchSummary' || message.role === 'compactionSummary') {
    return message.summary
  }
  if (message.role === 'toolResult') return contentToText(message.content)
  return ''
}

export function toolTarget(
  toolName: string,
  args: Record<string, unknown>
): string {
  const firstString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
  }

  if (toolName === 'bash') return firstString('command') ?? ''
  if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
    return firstString('path', 'file_path', 'filename') ?? ''
  }
  if (toolName === 'grep') {
    const pattern = firstString('pattern', 'query')
    const path = firstString('path', 'glob')
    return [pattern, path].filter(Boolean).join('  ')
  }
  if (toolName === 'find') {
    return firstString('pattern', 'glob', 'path') ?? ''
  }
  if (toolName === 'ls') return firstString('path') ?? '.'

  const target = firstString(
    'path',
    'file_path',
    'command',
    'pattern',
    'query',
    'url',
    'name'
  )
  if (target) return target

  const compact = JSON.stringify(args)
  return compact === '{}' ? '' : compact
}

export function toolOutput(execution?: ToolExecution): string {
  if (!execution) return ''
  const output = execution.output.trim()
  if (!output) return execution.isRunning ? '运行中…' : ''
  return output
}

export function formatDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined) return undefined
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value)
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, 'second')
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, 'minute')
  const deltaHours = Math.round(deltaMinutes / 60)
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, 'hour')
  const deltaDays = Math.round(deltaHours / 24)
  if (Math.abs(deltaDays) < 30) return formatter.format(deltaDays, 'day')
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function modelLabel(model?: PiModel | null): string {
  if (!model) return '未选择模型'
  return model.name || model.id.split('/').at(-1) || model.id
}

export function messageKey(message: AgentMessage): string {
  return `${message.role}:${message.timestamp}`
}

export function upsertMessage(
  messages: AgentMessage[],
  message: AgentMessage
): AgentMessage[] {
  const key = messageKey(message)
  const index = messages.findIndex((item) => messageKey(item) === key)
  if (index === -1) return [...messages, message]
  const next = messages.slice()
  next[index] = message
  return next
}

export function applyAssistantMessageUpdate(
  messages: AgentMessage[],
  update: Record<string, unknown>
): AgentMessage[] {
  let index = -1
  for (let candidate = messages.length - 1; candidate >= 0; candidate -= 1) {
    if (messages[candidate]?.role === 'assistant') {
      index = candidate
      break
    }
  }
  if (index === -1) return messages

  const message = messages[index]
  if (message.role !== 'assistant') return messages

  const contentIndex =
    typeof update.contentIndex === 'number' && update.contentIndex >= 0
      ? update.contentIndex
      : 0
  const type = typeof update.type === 'string' ? update.type : ''
  const delta = typeof update.delta === 'string' ? update.delta : ''
  const content = message.content.slice()
  const current = content[contentIndex]
  let nextBlock = current

  switch (type) {
    case 'text_start':
      nextBlock = { type: 'text', text: '' }
      break
    case 'text_delta':
      nextBlock = {
        type: 'text',
        text: `${current?.type === 'text' ? current.text : ''}${delta}`
      }
      break
    case 'text_end':
      nextBlock = {
        type: 'text',
        text: typeof update.content === 'string'
          ? update.content
          : current?.type === 'text'
            ? current.text
            : ''
      }
      break
    case 'thinking_start':
      nextBlock = { type: 'thinking', thinking: '' }
      break
    case 'thinking_delta':
      nextBlock = {
        type: 'thinking',
        thinking: `${current?.type === 'thinking' ? current.thinking : ''}${delta}`
      }
      break
    case 'thinking_end':
      nextBlock = {
        type: 'thinking',
        thinking: typeof update.content === 'string'
          ? update.content
          : current?.type === 'thinking'
            ? current.thinking
            : ''
      }
      break
    case 'toolcall_start':
      nextBlock = {
        type: 'toolCall',
        id: typeof update.id === 'string' ? update.id : '',
        name: typeof update.toolName === 'string' ? update.toolName : '',
        arguments: {}
      }
      break
    case 'toolcall_end': {
      const toolCall = update.toolCall
      if (
        toolCall &&
        typeof toolCall === 'object' &&
        'id' in toolCall &&
        'name' in toolCall &&
        'arguments' in toolCall
      ) {
        nextBlock = toolCall as ContentBlock
      }
      break
    }
  }

  if (nextBlock === current) return messages

  while (content.length < contentIndex) {
    content.push({ type: 'text', text: '' })
  }
  content[contentIndex] = nextBlock

  const next = messages.slice()
  next[index] = { ...message, content }
  return next
}

export function toolResultMap(messages: AgentMessage[]): Record<string, ToolExecution> {
  const executions: Record<string, ToolExecution> = {}

  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    const toolCall = messages
      .filter((entry) => entry.role === 'assistant')
      .flatMap((entry) => entry.content)
      .find(
        (block) =>
          block.type === 'toolCall' && block.id === message.toolCallId
      )
    const args =
      toolCall?.type === 'toolCall' ? toolCall.arguments : {}

    executions[message.toolCallId] = {
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      args,
      output: contentToText(message.content),
      isError: message.isError,
      isRunning: false,
      startedAt: message.timestamp
    }
  }

  return executions
}
