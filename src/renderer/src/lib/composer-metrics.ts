import type { AgentMessage, PiSessionStats } from '../../../shared/types'

export function nonnegative(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function cacheHitPercent(
  tokens?: Pick<PiSessionStats['tokens'], 'input' | 'cacheRead' | 'cacheWrite'>
): number | undefined {
  if (!tokens) return undefined
  const total = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return total > 0 ? (tokens.cacheRead / total) * 100 : undefined
}

export function summarizeTimings(messages: AgentMessage[]) {
  let modelMs: number | undefined
  let toolMs: number | undefined
  let timedOutput = 0
  let outputDurationMs = 0

  for (const message of messages) {
    if (message.role === 'assistant') {
      const duration = nonnegative(message.durationMs)
      if (duration === undefined) continue
      modelMs = (modelMs ?? 0) + duration
      const output = nonnegative(message.usage?.output)
      if (output !== undefined && output > 0 && duration > 0) {
        timedOutput += output
        outputDurationMs += duration
      }
    } else if (message.role === 'toolResult') {
      const duration = nonnegative(message.durationMs)
      if (duration !== undefined) toolMs = (toolMs ?? 0) + duration
    }
  }

  return {
    modelMs,
    toolMs,
    tokensPerSecond: outputDurationMs > 0 ? timedOutput * 1000 / outputDurationMs : undefined
  }
}
