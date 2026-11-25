import { ArrowLeftIcon, CheckIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { Popover } from '@astryxdesign/core/Popover'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { Slider } from '@astryxdesign/core/Slider'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { PiModel, PiSessionState, ThinkingLevel } from '../../../shared/types'
import { modelLabel } from '../lib/pi'
import { supportedThinkingLevels, THINKING_LABELS } from '../lib/thinking-levels'

interface ModelControlsProps {
  models: PiModel[]
  state: PiSessionState | null
  isDisabled: boolean
  onSetModel: (provider: string, modelId: string) => Promise<void>
  onSetThinkingLevel: (level: ThinkingLevel) => Promise<void>
}

export function ModelControls({
  models, state, isDisabled, onSetModel, onSetThinkingLevel
}: ModelControlsProps): React.JSX.Element {
  const [showModels, setShowModels] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const pending = useRef(false)
  const [preview, setPreview] = useState<number>()
  const backButton = useRef<HTMLButtonElement>(null)
  const modelButton = useRef<HTMLButtonElement>(null)
  const levels = supportedThinkingLevels(state?.model, state?.availableThinkingLevels)
  const current = state?.thinkingLevel
  const index = current ? levels.indexOf(current) : -1
  const value = preview ?? Math.max(0, index)
  const levelLabel = (position: number) => THINKING_LABELS[levels[Math.round(position)]]
  const activeEffort = current ? THINKING_LABELS[current] : undefined
  const effort = levelLabel(value) ?? activeEffort
  const name = modelLabel(state?.model)

  useEffect(() => {
    if (isOpen && showModels) backButton.current?.focus()
  }, [isOpen, showModels])

  async function apply(change: () => Promise<void>): Promise<void> {
    if (isDisabled || pending.current) return
    pending.current = true
    setIsPending(true)
    try {
      await change()
    } finally {
      pending.current = false
      setIsPending(false)
      setPreview(undefined)
    }
  }

  function setOpen(open: boolean): void {
    setIsOpen(open)
    if (open) setShowModels(false)
    if (!open) {
      setIsDragging(false)
      if (!pending.current) setPreview(undefined)
    }
  }

  function backToEffort(): void {
    setShowModels(false)
    requestAnimationFrame(() => modelButton.current?.focus())
  }

  const modelPicker = (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center">
        <Button
          ref={backButton}
          label="返回思考强度"
          icon={<Icon icon={ArrowLeftIcon} size="sm" />}
          isIconOnly
          variant="ghost"
          size="sm"
          onClick={backToEffort}
        />
        <Text type="label" weight="semibold">选择模型</Text>
      </HStack>
      <ScrollableArea label="模型列表" axis="block" overscroll="contain" height="16rem">
        <VStack gap={2}>
          {[...new Set(models.map(({ provider }) => provider))].map((provider) => (
            <VStack key={provider} gap={0.5}>
              <VStack paddingInline={2}>
                <Text type="supporting" color="secondary">{provider}</Text>
              </VStack>
              {models.filter((model) => model.provider === provider).map((model) => {
                const selected = state?.model?.id === model.id && state.model.provider === provider
                return (
                  <Button
                    key={model.id}
                    label={modelLabel(model)}
                    width="100%"
                    size="sm"
                    variant={selected ? 'secondary' : 'ghost'}
                    className="composer-model-choice"
                    aria-pressed={selected}
                    endContent={selected ? <Icon icon={CheckIcon} size="sm" /> : undefined}
                    isDisabled={isPending || isDisabled}
                    onClick={() => void apply(async () => {
                      if (!selected) await onSetModel(provider, model.id)
                      backToEffort()
                    })}
                  />
                )
              })}
            </VStack>
          ))}
          {models.length === 0 && <Text type="supporting" color="secondary">尚未配置模型</Text>}
        </VStack>
      </ScrollableArea>
    </VStack>
  )

  const effortPicker = (
    <VStack gap={3}>
      <HStack gap={2} hAlign="between" vAlign="center">
        <Text type="label" weight="semibold">思考强度</Text>
        <Text type="label" color="accent">{effort ?? '—'}</Text>
      </HStack>
      <Button
        ref={modelButton}
        label={name}
        aria-label={`选择模型，当前：${name}`}
        endContent={<Icon icon={ChevronRightIcon} size="sm" />}
        variant="secondary"
        size="sm"
        className="composer-model-choice"
        width="100%"
        isDisabled={isPending || isDisabled}
        onClick={() => setShowModels(true)}
      />
      {levels.length > 1 ? (
        <VStack gap={1}>
          <VStack
            className="composer-thinking-slider"
            data-dragging={isDragging || undefined}
            onPointerDownCapture={(event) => {
              if (event.button === 0 && event.pointerType === 'mouse' && !pending.current) setIsDragging(true)
            }}
            onPointerUpCapture={() => setIsDragging(false)}
            onPointerCancelCapture={() => setIsDragging(false)}
          >
            <Slider
              label="思考档位"
              isLabelHidden
              width="100%"
              min={0}
              max={levels.length - 1}
              step={isDragging ? 0.001 : 1}
              value={value}
              valueDisplay="none"
              formatValue={levelLabel}
              marks={levels.map((_, position) => ({ value: position }))}
              isDisabled={isDisabled}
              onChange={(position: number) => { if (!pending.current) setPreview(position) }}
              onChangeEnd={(position: number) => {
                if (pending.current) return
                const snapped = Math.round(position)
                const next = levels[snapped]
                if (next && next !== current) {
                  setPreview(snapped)
                  void apply(() => onSetThinkingLevel(next))
                } else {
                  setPreview(undefined)
                }
              }}
            />
          </VStack>
          <HStack hAlign="between" aria-hidden="true">
            <Text type="supporting" color="secondary">{THINKING_LABELS[levels[0]]}</Text>
            <Text type="supporting" color="secondary">{THINKING_LABELS[levels[levels.length - 1]]}</Text>
          </HStack>
        </VStack>
      ) : (
        <Text type="supporting" color="secondary">
          {levels.length === 1 ? `固定档位：${THINKING_LABELS[levels[0]]}` : '暂无可用思考档位'}
        </Text>
      )}
    </VStack>
  )

  return (
    <Popover
      label={showModels ? '选择模型' : '思考强度'}
      closeButtonLabel="关闭模型与思考设置"
      placement="above"
      alignment="end"
      width="17rem"
      padding={4}
      isOpen={isOpen}
      onOpenChange={setOpen}
      isEnabled={!isDisabled}
      content={showModels ? modelPicker : effortPicker}
    >
      <Button
        label={activeEffort ? `${name} · ${activeEffort}` : name}
        aria-label={`模型与思考强度：${name}${activeEffort ? '，' + activeEffort : ''}`}
        className="composer-model-trigger"
        variant="secondary"
        size="sm"
        isDisabled={isDisabled}
      />
    </Popover>
  )
}
