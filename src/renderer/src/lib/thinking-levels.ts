import type { PiModel, ThinkingLevel } from '../../../shared/types'

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高'
}

const levels = Object.keys(THINKING_LABELS) as ThinkingLevel[]

export function supportedThinkingLevels(
  model: PiModel | undefined,
  reported?: ThinkingLevel[]
): ThinkingLevel[] {
  if (reported) return levels.filter((level) => reported.includes(level))
  if (!model) return []
  if (!model.reasoning) return ['off']

  return levels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}
