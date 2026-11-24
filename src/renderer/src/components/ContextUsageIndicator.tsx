import type { CSSProperties } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Popover } from '@astryxdesign/core/Popover'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { PiSessionStats } from '../../../shared/types'
import { contextPercent } from '../lib/pi'

const tokenFormat = new Intl.NumberFormat('zh-CN')
const percentFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })

function tokenCount(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function formatTokens(value: number | undefined): string {
  return value === undefined ? '—' : tokenFormat.format(value)
}

function UsageRow({ label, value, marker }: {
  label: string
  value: number | undefined
  marker?: 'blue' | 'orange' | 'teal' | 'purple'
}): React.JSX.Element {
  return (
    <HStack hAlign="between" vAlign="center" gap={2}>
      <HStack as="span" vAlign="center" gap={1.5}>
        {marker && (
          <Stack
            as="span"
            aria-hidden="true"
            className="context-usage-marker"
            style={{ backgroundColor: `var(--color-data-categorical-${marker})` }}
          />
        )}
        <Text type="supporting" size="sm" color="secondary">{label}</Text>
      </HStack>
      <Text type="supporting" size="sm" hasTabularNumbers>{formatTokens(value)}</Text>
    </HStack>
  )
}

export function ContextUsageIndicator({
  stats,
  modelContextWindow
}: {
  stats: PiSessionStats | null
  modelContextWindow?: number
}): React.JSX.Element {
  const used = tokenCount(stats?.contextUsage?.tokens)
  const limit = tokenCount(stats?.contextUsage?.contextWindow) || tokenCount(modelContextWindow) || undefined
  const remaining = used !== undefined && limit !== undefined ? Math.max(0, limit - used) : undefined
  const percent = contextPercent(stats) ??
    (used !== undefined && limit !== undefined ? (used / limit) * 100 : undefined)
  const progress = Math.min(100, percent ?? 0)
  const percentLabel = percent === undefined ? '占用待统计' : `${percentFormat.format(percent)}%`
  const triggerLabel = `上下文用量 · ${percentLabel}`

  return (
    <Popover
      label="上下文用量"
      closeButtonLabel="关闭上下文用量"
      placement="above"
      alignment="end"
      width="18rem"
      padding={3}
      content={
        <VStack gap={2} className="context-usage-panel">
          <HStack hAlign="between" vAlign="center" gap={2}>
            <Text type="label" size="sm" weight="semibold">上下文窗口</Text>
            <Text type="label" size="sm" color="secondary" hasTabularNumbers>{percentLabel}</Text>
          </HStack>
          {percent !== undefined && (
            <ProgressBar label="当前上下文占用" isLabelHidden value={progress} />
          )}
          <VStack gap={0.5}>
            <UsageRow label="已用（估算）" value={used} />
            <UsageRow label="剩余（估算）" value={remaining} />
            <UsageRow label="窗口上限" value={limit} />
          </VStack>
          {stats?.tokens && (
            <VStack gap={1} className="context-usage-totals">
              <Text type="label" size="sm" weight="semibold">会话累计 Token</Text>
              <VStack gap={0.5}>
                <UsageRow label="输入" value={tokenCount(stats.tokens.input)} marker="blue" />
                <UsageRow label="输出" value={tokenCount(stats.tokens.output)} marker="orange" />
                <UsageRow label="缓存读取" value={tokenCount(stats.tokens.cacheRead)} marker="teal" />
                <UsageRow label="缓存写入" value={tokenCount(stats.tokens.cacheWrite)} marker="purple" />
                <UsageRow label="合计" value={tokenCount(stats.tokens.total)} />
              </VStack>
            </VStack>
          )}
        </VStack>
      }
    >
      <Button
        label={triggerLabel}
        tooltip={triggerLabel}
        variant="ghost"
        size="sm"
        isIconOnly
        icon={
          <Stack
            as="span"
            aria-hidden="true"
            className="context-usage-ring"
            style={{ '--context-progress': `${progress}%` } as CSSProperties}
          />
        }
      />
    </Popover>
  )
}
