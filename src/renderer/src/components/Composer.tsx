import { useMemo, useState, type ReactNode } from 'react'
import { AdjustmentsHorizontalIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import {
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatSendButton
} from '@astryxdesign/core/Chat'
import { Icon } from '@astryxdesign/core/Icon'
import { Popover } from '@astryxdesign/core/Popover'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead'
import type {
  AgentMessage,
  ImageContent,
  PiCommandInfo,
  PiModel,
  PiSessionStats,
  PiSessionState,
  ThinkingLevel
} from '../../../shared/types'
import type { ExtensionWidget } from '../hooks/usePiSession'
import { LAYOUT_WIDTHS } from '../lib/layout'
import { ComposerMetrics } from './ComposerMetrics'
import { ModelControls } from './ModelControls'

interface CommandAuxData {
  description?: string
  sourceLabel: string
  group: string
}

const commandSourceLabels: Record<PiCommandInfo['source'] | 'builtin', string> = {
  builtin: '内置',
  extension: '扩展',
  prompt: '提示词',
  skill: '技能'
}

const commandGroupLabels: Record<PiCommandInfo['source'] | 'builtin', string> = {
  builtin: '常用会话指令',
  extension: '扩展指令',
  prompt: '提示词模板',
  skill: 'Agent 技能'
}

const builtinCommands: { id: string; description: string }[] = [
  { id: 'compact', description: '压缩当前会话上下文，保留关键摘要' },
  { id: 'new', description: '开始一个新会话' },
  { id: 'name', description: '设置会话名称（/name 名称）' },
  { id: 'fork', description: '从历史用户消息分叉为新会话' },
  { id: 'clone', description: '克隆当前分支到新会话' },
  { id: 'copy', description: '复制最后一条助手回复' },
  { id: 'export', description: '导出当前会话为 HTML' }
]

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

async function filesToImages(files: File[]): Promise<ImageContent[]> {
  const images: ImageContent[] = []
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) continue
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const comma = result.indexOf(',')
        resolve(comma >= 0 ? result.slice(comma + 1) : '')
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    }).catch(() => '')
    if (data) images.push({ type: 'image', data, mimeType: file.type })
  }
  return images
}

function WidgetSection({
  widgets
}: {
  widgets: [string, ExtensionWidget][]
}): React.JSX.Element | null {
  if (widgets.length === 0) return null
  return (
    <VStack width="100%" gap={2}>
      {widgets.map(([key, widget]) => (
        <Card key={key} variant="muted" padding={3} width="100%">
          <VStack gap={0.5}>
            {widget.lines.map((line, index) => (
              <Text key={`${key}:${index}`} type="supporting" color="secondary">
                {line}
              </Text>
            ))}
          </VStack>
        </Card>
      ))}
    </VStack>
  )
}

interface ComposerProps {
  projectPicker?: ReactNode
  value: string
  images: ImageContent[]
  models: PiModel[]
  commands: PiCommandInfo[]
  status: string | null
  commandStatuses: Record<string, string>
  widgets: Record<string, ExtensionWidget>
  queuedCount: number
  isRetrying: boolean
  isBashRunning: boolean
  streamingBehavior: 'steer' | 'followUp'
  autoRetryEnabled: boolean
  state: PiSessionState | null
  stats: PiSessionStats | null
  messages: AgentMessage[]
  isConnecting: boolean
  isStreaming: boolean
  onChange: (value: string) => void
  onAddImages: (images: ImageContent[]) => void
  onRemoveImage: (index: number) => void
  onSubmit: (value: string, images: ImageContent[]) => void
  onStop: () => void
  onClearQueue: () => Promise<void>
  onAbortRetry: () => Promise<void>
  onStreamingBehaviorChange: (behavior: 'steer' | 'followUp') => void
  onSetSteeringMode: (mode: 'all' | 'one-at-a-time') => Promise<void>
  onSetFollowUpMode: (mode: 'all' | 'one-at-a-time') => Promise<void>
  onSetAutoCompaction: (enabled: boolean) => Promise<void>
  onCompact?: () => Promise<boolean>
  onSetAutoRetry: (enabled: boolean) => Promise<void>
  onSetModel: (provider: string, modelId: string) => Promise<void>
  onSetThinkingLevel: (level: ThinkingLevel) => Promise<void>
}

export function Composer({
  projectPicker,
  value,
  images,
  models,
  commands,
  status,
  commandStatuses,
  widgets,
  queuedCount,
  isRetrying,
  isBashRunning,
  streamingBehavior,
  autoRetryEnabled,
  state,
  stats,
  messages,
  isConnecting,
  isStreaming,
  onChange,
  onAddImages,
  onRemoveImage,
  onSubmit,
  onStop,
  onClearQueue,
  onAbortRetry,
  onStreamingBehaviorChange,
  onSetSteeringMode,
  onSetFollowUpMode,
  onSetAutoCompaction,
  onCompact,
  onSetAutoRetry,
  onSetModel,
  onSetThinkingLevel
}: ComposerProps): React.JSX.Element {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const slashTrigger = useMemo(() => {
    const items: SearchableItem<CommandAuxData>[] = [
      ...builtinCommands.map((command) => ({
        id: command.id,
        label: command.id,
        auxiliaryData: {
          description: command.description,
          sourceLabel: commandSourceLabels.builtin,
          group: commandGroupLabels.builtin
        }
      })),
      ...commands.map((command) => ({
        id: command.name,
        label: command.name,
        auxiliaryData: {
          description: command.description,
          sourceLabel: commandSourceLabels[command.source] ?? command.source,
          group: commandGroupLabels[command.source] ?? '其他指令'
        }
      }))
    ]
    const seen = new Set<string>()
    const uniqueItems = items.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })

    return {
      character: '/',
      menuLabel: 'Pi 命令',
      emptySearchText: '没有匹配的 Pi 命令',
      searchSource: createStaticSource(uniqueItems, {
        keywords: (item) =>
          item.auxiliaryData?.description
            ? [item.auxiliaryData.description, item.auxiliaryData.sourceLabel]
            : [item.auxiliaryData?.sourceLabel ?? '']
      }),
      renderItem: (item: SearchableItem) => {
        const aux = item.auxiliaryData as CommandAuxData | undefined
        return (
          <HStack gap={3} vAlign="center" width="100%" className="slash-command-row">
            <Text type="code" size="sm" className="slash-command-name">/{item.id}</Text>
            {aux?.description ? (
              <Text type="supporting" color="secondary" maxLines={1} className="slash-command-desc">
                {aux.description}
              </Text>
            ) : (
              <Stack className="slash-command-desc" />
            )}
            {aux?.sourceLabel && (
              <Text type="supporting" color="secondary" className="slash-command-source">
                {aux.sourceLabel}
              </Text>
            )}
          </HStack>
        )
      },
      onSelect: (item: SearchableItem) => `/${item.id} `
    }
  }, [commands])

  const extensionNotes = Object.values(commandStatuses).filter(Boolean)
  const statusSummary = [status, ...extensionNotes].filter(Boolean).join(' · ')
  const activeRun = isStreaming || isBashRunning
  const composerStatus = isStreaming && (value.trim().length > 0 || images.length > 0)
    ? {
        type: 'warning' as const,
        message: streamingBehavior === 'steer'
          ? '运行中发送将作为引导消息（steer）插入当前轮次'
          : '运行中发送将进入追问队列（followUp），等待本轮结束后处理'
      }
    : undefined

  const widgetEntries = Object.entries(widgets)
  const aboveWidgets = widgetEntries.filter(([, widget]) => widget.placement === 'aboveEditor')
  const belowWidgets = widgetEntries.filter(([, widget]) => widget.placement === 'belowEditor')

  const handleChooseImages = async (): Promise<void> => {
    const chosen = await window.piDesktop.chooseImages()
    if (chosen.length > 0) onAddImages(chosen)
  }

  const handleFilesDropOrPaste = async (files: File[]): Promise<void> => {
    const converted = await filesToImages(files)
    if (converted.length > 0) onAddImages(converted)
  }

  const isDisabled = isConnecting || !state
  const canSend = !isDisabled && (value.trim().length > 0 || images.length > 0)

  return (
    <VStack width="100%" maxWidth={LAYOUT_WIDTHS.chatColumn} gap={2} paddingBlockEnd={3}
      hAlign="center" style={{ marginInline: 'auto' }}>
      <WidgetSection widgets={aboveWidgets} />
      <VStack width="100%" gap={1.5}>
        {projectPicker}
        <ChatComposer
        style={{ width: '100%' }}
        value={value}
        onChange={onChange}
        onSubmit={(submitted) => onSubmit(submitted, images)}
        placeholder={
          state
            ? '给 Pi 发消息，/ 查看命令，! 执行命令…'
            : '正在连接 Pi…'
        }
        isDisabled={isDisabled}
        elevation="low"
        status={composerStatus}
        drawer={
          images.length > 0 ? (
            <ChatComposerDrawer count={images.length} label="张图片">
              <HStack gap={2} wrap="wrap" vAlign="center">
                {images.map((image, index) => (
                  <HStack key={`${image.mimeType}:${index}`} gap={1} vAlign="center">
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`待发送图片 ${index + 1}`}
                      className="composer-attachment-thumb"
                    />
                    <Button
                      label={`移除图片 ${index + 1}`}
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={XMarkIcon} size="sm" />}
                      onClick={() => onRemoveImage(index)}
                    />
                  </HStack>
                ))}
              </HStack>
            </ChatComposerDrawer>
          ) : undefined
        }
        headerActions={
          statusSummary ? (
            <HStack gap={2} vAlign="center">
              <StatusDot
                variant={activeRun ? 'accent' : 'neutral'}
                isPulsing={activeRun}
                label={statusSummary}
              />
              <Text type="supporting" color="secondary" maxLines={1}>
                {statusSummary}
              </Text>
            </HStack>
          ) : undefined
        }
        headerContext={
          queuedCount > 0 || isRetrying ? (
            <HStack gap={1} vAlign="center">
              {queuedCount > 0 && (
                <Button
                  label="清空队列"
                  variant="ghost"
                  size="sm"
                  onClick={() => void onClearQueue()}
                />
              )}
              {isRetrying && (
                <Button
                  label="取消重试"
                  variant="ghost"
                  size="sm"
                  onClick={() => void onAbortRetry()}
                />
              )}
            </HStack>
          ) : undefined
        }
        input={
          <ChatComposerInput
            triggers={[slashTrigger]}
            debounceMs={0}
            onFiles={(files) => void handleFilesDropOrPaste(files)}
          />
        }
        footerActions={
          <HStack gap={1} vAlign="center">
            <Button
              label="添加图片"
              variant="ghost"
              size="sm"
              isIconOnly
              tooltip="添加图片"
              isDisabled={isDisabled}
              icon={<Icon icon={PhotoIcon} size="sm" />}
              onClick={() => void handleChooseImages()}
            />
            <Popover
              label="会话运行选项"
              closeButtonLabel="关闭会话运行选项"
              placement="above"
              alignment="start"
              width="19rem"
              padding={4}
              isOpen={isSettingsOpen}
              onOpenChange={setIsSettingsOpen}
              isEnabled={!isDisabled}
              content={
                <VStack gap={3}>
                  <Text type="label" weight="semibold">会话运行选项</Text>
                  <VStack gap={1}>
                    <Text type="supporting" color="secondary">流式发送行为</Text>
                    <SegmentedControl
                      label="流式发送行为"
                      value={streamingBehavior}
                      onChange={(next) => onStreamingBehaviorChange(next === 'followUp' ? 'followUp' : 'steer')}
                      size="sm"
                      layout="fill"
                    >
                      <SegmentedControlItem value="steer" label="引导插队" />
                      <SegmentedControlItem value="followUp" label="结束后追问" />
                    </SegmentedControl>
                  </VStack>
                  {state && (
                    <>
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">引导队列投递</Text>
                        <SegmentedControl
                          label="引导队列投递"
                          value={state.steeringMode}
                          onChange={(next) => void onSetSteeringMode(next === 'all' ? 'all' : 'one-at-a-time')}
                          size="sm"
                          layout="fill"
                        >
                          <SegmentedControlItem value="one-at-a-time" label="逐条" />
                          <SegmentedControlItem value="all" label="全部" />
                        </SegmentedControl>
                      </VStack>
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">追问队列投递</Text>
                        <SegmentedControl
                          label="追问队列投递"
                          value={state.followUpMode}
                          onChange={(next) => void onSetFollowUpMode(next === 'all' ? 'all' : 'one-at-a-time')}
                          size="sm"
                          layout="fill"
                        >
                          <SegmentedControlItem value="one-at-a-time" label="逐条" />
                          <SegmentedControlItem value="all" label="全部" />
                        </SegmentedControl>
                      </VStack>
                    </>
                  )}
                  <Switch
                    label="失败后自动重试"
                    size="sm"
                    labelSpacing="spread"
                    width="100%"
                    value={autoRetryEnabled}
                    onChange={(checked) => void onSetAutoRetry(checked)}
                  />
                </VStack>
              }
            >
              <Button
                label="会话运行选项"
                variant="ghost"
                size="sm"
                isIconOnly
                tooltip="会话运行选项"
                isDisabled={isDisabled}
                icon={<Icon icon={AdjustmentsHorizontalIcon} size="sm" />}
              />
            </Popover>
          </HStack>
        }
        sendActions={
          <ModelControls
            key={state?.sessionId}
            models={models}
            state={state}
            isDisabled={isConnecting || activeRun}
            onSetModel={onSetModel}
            onSetThinkingLevel={onSetThinkingLevel}
          />
        }
        sendButton={
          <ChatSendButton
            isStopShown={activeRun}
            isDisabled={activeRun ? false : !canSend}
            onSend={() => onSubmit(value, images)}
            onStop={onStop}
          />
        }
        isStopShown={activeRun}
        onStop={onStop}
      />
      </VStack>
      <WidgetSection widgets={belowWidgets} />
      <ComposerMetrics
        key={state?.sessionId}
        messages={messages}
        stats={stats}
        modelContextWindow={state?.model?.contextWindow}
        autoCompactionEnabled={state?.autoCompactionEnabled}
        isStreaming={isStreaming}
        hasMessages={messages.length > 0}
        onSetAutoCompaction={state ? onSetAutoCompaction : undefined}
        onCompact={state ? onCompact : undefined}
      />
    </VStack>
  )
}
