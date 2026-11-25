import type { AgentMessage } from '../../../shared/types'

export interface SessionEntryLike {
  id?: string
  parentId?: string | null
  type?: string
  message?: {
    role?: string
    timestamp?: number
  }
}

const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1
})

const localTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

const localZone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })

export function assistantTurnStartedAt(
  messages: AgentMessage[],
  index: number
): number | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor]
    if (message?.role === 'user') return message.timestamp
  }
  return undefined
}

function turnRange(messages: AgentMessage[], index: number): { start: number; end: number } | undefined {
  let start = -1
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === 'user') {
      start = cursor
      break
    }
  }
  if (start === -1) return undefined

  let end = messages.length
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    if (messages[cursor]?.role === 'user') {
      end = cursor
      break
    }
  }
  return { start, end }
}

export function isFinalAssistantOfTurn(messages: AgentMessage[], index: number): boolean {
  const range = turnRange(messages, index)
  if (!range) return true
  for (let cursor = index + 1; cursor < range.end; cursor += 1) {
    if (messages[cursor]?.role === 'assistant') return false
  }
  return true
}

export function assistantTurnElapsedMs(
  messages: AgentMessage[],
  index: number,
  now: number,
  isActiveTurn: boolean
): number | undefined {
  const range = turnRange(messages, index)
  if (!range) return undefined

  let total = 0
  let hasTiming = false
  for (let cursor = range.start; cursor < range.end; cursor += 1) {
    const message = messages[cursor]
    if (message?.role !== 'assistant' && message?.role !== 'toolResult') continue
    if (typeof message.durationMs === 'number' && Number.isFinite(message.durationMs)) {
      total += message.durationMs
      hasTiming = true
    } else if (
      isActiveTurn &&
      message.role === 'assistant' &&
      cursor === index &&
      typeof message.timestamp === 'number'
    ) {
      total += Math.max(0, now - message.timestamp)
      hasTiming = true
    }
  }
  return hasTiming ? total : undefined
}

export function formatElapsedDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return undefined
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000))
  if (totalSeconds === 0) return '不到 1 秒'
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分`
}

export function formatTokenUsage(tokens?: number): string | undefined {
  if (tokens === undefined || !Number.isFinite(tokens)) return undefined
  return `${compactNumber.format(tokens)} tok`
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? ''
}

export function formatLocalTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined
  const date = new Date(timestamp)
  const parts = localTime.formatToParts(date)
  const time = `${partValue(parts, 'month')}月${partValue(parts, 'day')}日 ${partValue(parts, 'hour')}:${partValue(parts, 'minute')}`
  const zone = partValue(localZone.formatToParts(date), 'timeZoneName')
  return zone ? `${time} ${zone}` : time
}

export function userMessageEntryIds(
  entries: SessionEntryLike[],
  leafId?: string | null
): Record<number, string> {
  const byId = new Map<string, SessionEntryLike>()
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry)
  }

  const result: Record<number, string> = {}
  const visited = new Set<string>()
  let current = leafId ? byId.get(leafId) : undefined
  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id)
    const message = current.message
    if (message?.role === 'user' && typeof message.timestamp === 'number') {
      result[message.timestamp] = current.id
    }
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return result
}
