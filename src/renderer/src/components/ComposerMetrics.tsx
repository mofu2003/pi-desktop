import { CircleStackIcon, ClockIcon } from '@heroicons/react/24/outline'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { Icon } from '@astryxdesign/core/Icon'
import { Popover } from '@astryxdesign/core/Popover'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import type { AgentMessage, PiSessionStats } from '../../../shared/types'
import { cacheHitPercent, nonnegative, summarizeTimings } from '../lib/composer-metrics'

const counts = new Intl.NumberFormat('zh-CN')
const decimals = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
})

function format(value: number | undefined, suffix = ''): string {
  return value === undefined ? '—' : counts.format(value) + suffix
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : decimals.format(value) + '%'
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—'
  const seconds = ms / 1000
  if (seconds < 60) return decimals.format(seconds) + ' 秒'
  return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`
}

function MetricRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <HStack gap={2} hAlign="between" vAlign="center">
      <Text type="supporting" color="secondary">{label}</Text>
      <Text type="supporting" color="primary" hasTabularNumbers>{value}</Text>
    </HStack>
  )
}

type MetricId = 'session' | 'tokens' | 'context'

export function ComposerMetrics({
  messages,
  stats,
  modelContextWindow,
  autoCompactionEnabled,
  isStreaming = false,
  hasMessages = false,
  onSetAutoCompaction,
  onCompact
}: {
  messages: AgentMessage[]
  stats: PiSessionStats | null
  modelContextWindow?: number
  autoCompactionEnabled?: boolean
  isStreaming?: boolean
  hasMessages?: boolean
  onSetAutoCompaction?: (enabled: boolean) => Promise<void>
  onCompact?: () => Promise<boolean>
}): React.JSX.Element {
  const [open, setOpen] = useState<MetricId | null>(null)
  const [isCompacting, setIsCompacting] = useState(false)
  const timing = useMemo(() => summarizeTimings(messages), [messages])
  const rounds = stats?.userMessages
  const steps = stats ? stats.assistantMessages + stats.toolCalls : undefined
  const speed = timing.tokensPerSecond === undefined ? '—' : `${decimals.format(timing.tokensPerSecond)} tok/s`
  const tokens = stats?.tokens
  const hitRate = cacheHitPercent(tokens)
  const used = nonnegative(stats?.contextUsage?.tokens)
  const limit = nonnegative(stats?.contextUsage?.contextWindow) || nonnegative(modelContextWindow) || undefined
  const remaining = used !== undefined && limit !== undefined ? Math.max(0, limit - used) : undefined
  const percent = nonnegative(stats?.contextUsage?.percent) ??
    (used !== undefined && limit !== undefined ? used / limit * 100 : undefined)
  const progress = Math.min(100, percent ?? 0)
  const costText = stats?.cost === undefined ? '—' : currency.format(stats.cost)

  function metric(
    id: MetricId,
    label: string,
    summary: string,
    icon: ReactNode,
    content: ReactNode,
    popoverWidth = '16rem'
  ) {
    return (
      <Popover
        label={label}
        closeButtonLabel={`关闭${label}`}
        placement="above"
        alignment="center"
        width={popoverWidth}
        padding={4}
        isOpen={open === id}
        onOpenChange={(shown) => setOpen((previous) => shown ? id : previous === id ? null : previous)}
        content={
          <VStack gap={2}>
            <Text type="label" weight="semibold">{label}</Text>
            <VStack gap={1.5}>{content}</VStack>
          </VStack>
        }
      >
        <Button
          label={`${label} · ${summary}`}
          variant="ghost"
          size="sm"
          icon={icon}
        >
          <Text type="supporting" color="secondary" hasTabularNumbers>{summary}</Text>
        </Button>
      </Popover>
    )
  }

  return (
    <HStack
      role="group"
      aria-label="会话指标"
      gap={3}
      hAlign="center"
      vAlign="center"
      wrap="wrap"
    >
      {metric(
        'session',
        '会话统计',
        rounds === undefined ? '会话统计 · —' : `${format(rounds)} 轮 · ${format(steps)} 步${timing.tokensPerSecond === undefined ? '' : ` · ${speed}`}`,
        <Icon icon={ClockIcon} size="sm" color="secondary" />,
        <>
          <MetricRow label="对话轮数" value={format(rounds)} />
          <MetricRow label="模型回复" value={format(stats?.assistantMessages)} />
          <MetricRow label="工具调用" value={format(stats?.toolCalls)} />
          <MetricRow label="模型用时" value={formatDuration(timing.modelMs)} />
          <MetricRow label="工具用时" value={formatDuration(timing.toolMs)} />
          <MetricRow label="输出速率" value={speed} />
        </>
      )}
      {metric(
        'tokens',
        'Token 用量',
        tokens ? `${compact.format(tokens.total)} tok · 缓存 ${formatPercent(hitRate)}` : 'Token 用量 · —',
        <Icon icon={CircleStackIcon} size="sm" color="secondary" />,
        <>
          <MetricRow label="累计 Token" value={format(tokens?.total)} />
          <MetricRow label="缓存命中" value={formatPercent(hitRate)} />
          <MetricRow label="未缓存输入" value={format(tokens?.input)} />
          <MetricRow label="缓存读取" value={format(tokens?.cacheRead)} />
          <MetricRow label="缓存写入" value={format(tokens?.cacheWrite)} />
          <MetricRow label="输出" value={format(tokens?.output)} />
          <MetricRow label="累计费用" value={costText} />
        </>
      )}
      {metric(
        'context',
        '上下文占用',
        `上下文 ${formatPercent(percent)}`,
        <Stack
          as="span"
          aria-hidden="true"
          className="context-usage-ring"
          style={{ '--context-progress': `${progress}%` } as CSSProperties}
        />,
        <>
          <MetricRow label="已用比例" value={formatPercent(percent)} />
          {percent !== undefined && <ProgressBar label="上下文占用" isLabelHidden value={progress} />}
          <MetricRow label="已用" value={format(used, ' tok')} />
          <MetricRow label="剩余" value={format(remaining, ' tok')} />
          <MetricRow label="窗口上限" value={format(limit, ' tok')} />
          {(onSetAutoCompaction || onCompact) && (
            <>
              <Divider />
              {onSetAutoCompaction && autoCompactionEnabled !== undefined && (
                <VStack gap={1}>
                  <Switch
                    label="自动压缩上下文"
                    size="sm"
                    labelSpacing="spread"
                    width="100%"
                    value={autoCompactionEnabled}
                    onChange={(checked) => void onSetAutoCompaction(checked)}
                  />
                  <Text type="supporting" color="secondary">
                    接近上下文上限时自动提炼摘要，释放可用窗口
                  </Text>
                </VStack>
              )}
              {onCompact && (
                <Button
                  label={isCompacting ? '正在压缩上下文…' : '立即压缩上下文'}
                  variant="secondary"
                  size="sm"
                  width="100%"
                  isDisabled={isStreaming || isCompacting || !hasMessages}
                  onClick={() => {
                    if (isCompacting) return
                    setIsCompacting(true)
                    void onCompact().finally(() => setIsCompacting(false))
                  }}
                />
              )}
            </>
          )}
        </>,
        '18.5rem'
      )}
    </HStack>
  )
}
