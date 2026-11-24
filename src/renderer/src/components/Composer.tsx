import {
  ChatComposer,
  ChatMessageMetadata
} from '@astryxdesign/core/Chat'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type {
  PiModel,
  PiSessionState,
  ThinkingLevel
} from '../../../shared/types'
import { modelLabel } from '../lib/pi'

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
]

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高'
}

interface ComposerProps {
  value: string
  models: PiModel[]
  state: PiSessionState | null
  isConnecting: boolean
  isStreaming: boolean
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onStop: () => void
  onSetModel: (provider: string, modelId: string) => void
  onSetThinkingLevel: (level: ThinkingLevel) => void
}

export function Composer({
  value,
  models,
  state,
  isConnecting,
  isStreaming,
  onChange,
  onSubmit,
  onStop,
  onSetModel,
  onSetThinkingLevel
}: ComposerProps): React.JSX.Element {
  const modelItems =
    models.length > 0
      ? [...new Set(models.map((model) => model.provider))].map((provider) => ({
          type: 'section' as const,
          title: provider,
          items: models
            .filter((model) => model.provider === provider)
            .map((model) => ({
              id: `${model.provider}/${model.id}`,
              label: model.name || model.id,
              description:
                model.name && model.name !== model.id ? model.id : undefined,
              endContent:
                state?.model?.id === model.id &&
                state.model.provider === model.provider ? (
                  <Text type="supporting">✓</Text>
                ) : undefined,
              onClick: () => onSetModel(model.provider, model.id)
            }))
        }))
      : [{ label: '尚未配置模型', isDisabled: true }]

  const thinkingItems = THINKING_LEVELS.map((level) => ({
    label: THINKING_LABELS[level],
    endContent:
      state?.thinkingLevel === level ? (
        <Text type="supporting">✓</Text>
      ) : undefined,
    onClick: () => onSetThinkingLevel(level)
  }))

  return (
    <HStack width="100%" hAlign="center" className="composer-shell">
      <ChatComposer
        style={{ width: '100%' }}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={
          state
            ? '给 Pi 发消息…'
            : '正在连接 Pi…'
        }
        isDisabled={isConnecting || !state}
        elevation="low"
        footerActions={
          <HStack gap={0.5} vAlign="center">
            <DropdownMenu
              button={{
                label: modelLabel(state?.model),
                variant: 'ghost',
                size: 'sm'
              }}
              items={modelItems}
              placement="above"
              alignment="start"
              menuWidth={280}
            />
            <DropdownMenu
              button={{
                label: `思考 · ${THINKING_LABELS[state?.thinkingLevel ?? 'off']}`,
                variant: 'ghost',
                size: 'sm'
              }}
              items={thinkingItems}
              placement="above"
              alignment="start"
              menuWidth={190}
            />
          </HStack>
        }
        isStopShown={isStreaming}
        onStop={onStop}
        headerContext={
          value.length > 0 ? (
            <ChatMessageMetadata>
              <Text type="supporting" color="secondary">
                Enter 发送 · Shift+Enter 换行
              </Text>
            </ChatMessageMetadata>
          ) : undefined
        }
      />
    </HStack>
  )
}
