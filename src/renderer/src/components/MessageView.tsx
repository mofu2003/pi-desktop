import { useEffect, useState } from 'react'
import {
  ArrowUturnLeftIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  CircleStackIcon,
  FolderOpenIcon
} from '@heroicons/react/24/outline'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import {
  ChatMessage,
  ChatMessageBubble,
  ChatSystemMessage
} from '@astryxdesign/core/Chat'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Markdown } from '@astryxdesign/core/Markdown'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type {
  AgentMessage,
  AssistantMessage,
  ContentBlock,
  ImageContent,
  ToolExecution
} from '../../../shared/types'
import { contentToText } from '../lib/pi'
import {
  assistantTurnElapsedMs,
  formatElapsedDuration,
  formatLocalTimestamp,
  formatTokenUsage,
  isFinalAssistantOfTurn
} from '../lib/message-meta'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolActivity } from './ToolActivity'

function extractImages(content: string | ContentBlock[]): ImageContent[] {
  if (!Array.isArray(content)) return []
  return content.filter((block): block is ImageContent => block.type === 'image')
}

function MessageImages({ images }: { images: ImageContent[] }): React.JSX.Element | null {
  if (images.length === 0) return null
  return (
    <HStack gap={2} wrap="wrap">
      {images.map((image, index) => (
        <img
          key={`${image.mimeType}:${index}`}
          src={`data:${image.mimeType};base64,${image.data}`}
          alt={`附件图片 ${index + 1}`}
          className="message-attachment-image"
        />
      ))}
    </HStack>
  )
}

function CopyButton({
  text,
  label = '复制消息'
}: {
  text: string
  label?: string
}): React.JSX.Element {
  const [hasCopied, setHasCopied] = useState(false)

  useEffect(() => {
    if (!hasCopied) return
    const timer = setTimeout(() => setHasCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [hasCopied])

  const title = hasCopied ? '已复制' : label
  return (
    <IconButton
      label={title}
      tooltip={title}
      variant="ghost"
      size="sm"
      isDisabled={!text}
      icon={<Icon icon={hasCopied ? CheckIcon : ClipboardDocumentIcon} size="sm" />}
      onClick={() => {
        if (!text) return
        void window.piDesktop
          .copyText(text)
          .then(() => setHasCopied(true))
          .catch(() => {})
      }}
    />
  )
}

function useElapsedNow(isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isActive) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isActive])
  return now
}

export function UserMessageBubble({
  text,
  images = [],
  entryId,
  isStreaming = false,
  onRetract
}: {
  text: string
  images?: ImageContent[]
  entryId?: string
  isStreaming?: boolean
  onRetract?: (entryId: string) => void
}): React.JSX.Element {
  const canRetract = Boolean(entryId) && Boolean(onRetract) && !isStreaming
  return (
    <ChatMessage
      sender="user"
      metadata={
        <HStack gap={1} vAlign="center" hAlign="end">
          <CopyButton text={text} />
          {onRetract && (
            <IconButton
              label="撤回"
              tooltip={
                !entryId
                  ? '消息尚未写入会话'
                  : isStreaming
                    ? '等待本轮结束后可撤回'
                    : '撤回此消息及之后的回复，并把原文放回输入框'
              }
              variant="ghost"
              size="sm"
              isDisabled={!canRetract}
              icon={<Icon icon={ArrowUturnLeftIcon} size="sm" />}
              onClick={() => {
                if (entryId) onRetract(entryId)
              }}
            />
          )}
        </HStack>
      }
    >
      <ChatMessageBubble width="fit-content">
        <VStack gap={2}>
          <MessageImages images={images} />
          {text && (
            <Text type="body" className="message-prewrap">
              {text}
            </Text>
          )}
        </VStack>
      </ChatMessageBubble>
    </ChatMessage>
  )
}

export function RunningBashView({
  command,
  output
}: {
  command: string
  output: string
}): React.JSX.Element {
  return (
    <VStack gap={2} width="100%">
      <ChatSystemMessage>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <StatusDot variant="accent" isPulsing label="正在执行 Bash 命令" />
          <Text type="code" color="secondary">
            $ {command}
          </Text>
        </HStack>
      </ChatSystemMessage>
      <CodeBlock
        code={output.trim() || '正在执行…'}
        language="plaintext"
        size="sm"
        container="section"
        hasLanguageLabel={false}
        hasLineNumbers={false}
        isWrapped
        maxHeight={260}
      />
    </VStack>
  )
}

function assistantStatusLabel(message: AssistantMessage): string {
  if (message.stopReason === 'aborted') return '已停止'
  if (message.stopReason === 'error' || message.errorMessage) return '已出错'
  if (message.stopReason === 'length') return '已截断'
  return '已完成'
}

export function MessageView({
  message,
  messages,
  messageIndex,
  executions,
  isStreaming,
  userEntryId,
  onRetractUserMessage,
  onRevealFile
}: {
  message: AgentMessage
  messages: AgentMessage[]
  messageIndex: number
  executions: Record<string, ToolExecution>
  isStreaming: boolean
  userEntryId?: string
  onRetractUserMessage?: (entryId: string) => void
  onRevealFile?: (path: string) => void
}): React.JSX.Element | null {
  if (message.role === 'toolResult') return null

  if (message.role === 'compactionSummary') {
    return (
      <ChatSystemMessage>
        <Text type="supporting" color="secondary">
          已压缩上下文（压缩前 {message.tokensBefore.toLocaleString('zh-CN')} tokens）
        </Text>
      </ChatSystemMessage>
    )
  }

  if (message.role === 'branchSummary') {
    return (
      <ChatSystemMessage>
        <Text type="supporting" color="secondary">
          已从另一个分支继续
        </Text>
      </ChatSystemMessage>
    )
  }

  if (message.role === 'bashExecution') {
    const notes: string[] = []
    if (message.cancelled) notes.push('已取消')
    else if (message.exitCode !== undefined && message.exitCode !== 0) {
      notes.push(`退出码 ${message.exitCode}`)
    }
    if (message.truncated) notes.push('输出已截断')
    const output = message.output.trim()

    return (
      <VStack gap={2} width="100%">
        <ChatSystemMessage>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="code" color="secondary">
              $ {message.command}
            </Text>
            {notes.length > 0 && (
              <Text type="supporting" color="secondary">
                （{notes.join(' · ')}）
              </Text>
            )}
            {message.fullOutputPath && onRevealFile && (
              <Button
                label="查看完整输出"
                variant="ghost"
                size="sm"
                icon={<Icon icon={FolderOpenIcon} size="sm" />}
                onClick={() => onRevealFile(message.fullOutputPath!)}
              />
            )}
          </HStack>
        </ChatSystemMessage>
        {output && (
          <CodeBlock
            code={output}
            language="plaintext"
            size="sm"
            container="section"
            hasLanguageLabel={false}
            hasLineNumbers={false}
            isWrapped
            maxHeight={260}
          />
        )}
      </VStack>
    )
  }

  if (message.role === 'custom') {
    if (!message.display) return null
    const images = extractImages(message.content)
    const text = contentToText(message.content)
    return (
      <ChatSystemMessage>
        <VStack gap={2}>
          <MessageImages images={images} />
          {text && (
            <Text type="supporting" color="secondary">
              {text}
            </Text>
          )}
        </VStack>
      </ChatSystemMessage>
    )
  }

  if (message.role === 'user') {
    return (
      <UserMessageBubble
        text={contentToText(message.content)}
        images={extractImages(message.content)}
        entryId={userEntryId}
        isStreaming={isStreaming}
        onRetract={onRetractUserMessage}
      />
    )
  }

  if (message.role !== 'assistant') return null

  return (
    <AssistantMessageView
      message={message}
      messages={messages}
      messageIndex={messageIndex}
      isStreaming={isStreaming}
      executions={executions}
    />
  )
}

function AssistantMessageView({
  message,
  messages,
  messageIndex,
  isStreaming,
  executions
}: {
  message: AssistantMessage
  messages: AgentMessage[]
  messageIndex: number
  isStreaming: boolean
  executions: Record<string, ToolExecution>
}): React.JSX.Element | null {
  const isTurnFinal = isFinalAssistantOfTurn(messages, messageIndex)
  const now = useElapsedNow(isStreaming && isTurnFinal)
  const text = message.content
    .filter(
      (block): block is Extract<typeof block, { type: 'text' }> =>
        block.type === 'text'
    )
    .map((block) => block.text)
    .join('')
  const thinking = message.content
    .filter(
      (block): block is Extract<typeof block, { type: 'thinking' }> =>
        block.type === 'thinking' && !block.redacted
    )
    .map((block) => block.thinking)
    .join('\n')
  const hasRedactedThinking = message.content.some(
    (block) => block.type === 'thinking' && block.redacted
  )
  const images = extractImages(message.content)
  const hasTools = message.content.some((block) => block.type === 'toolCall')
  const stopNote = message.stopReason === 'length'
    ? '达到输出上限，回复已截断'
    : message.stopReason === 'aborted'
      ? '已停止生成'
      : undefined
  const hasBody = Boolean(
    text || thinking || hasRedactedThinking || images.length > 0 ||
      message.errorMessage || stopNote
  )

  if (!hasBody && !hasTools) return null

  const elapsedMs = isTurnFinal
    ? assistantTurnElapsedMs(messages, messageIndex, now, isStreaming)
    : undefined
  const elapsed = formatElapsedDuration(elapsedMs)
  const statusText = elapsed
    ? `${isStreaming ? '生成中' : assistantStatusLabel(message)}，用时 ${elapsed}`
    : undefined
  const tokens = formatTokenUsage(message.usage?.totalTokens)
  const localTime = formatLocalTimestamp(
    isStreaming ? now : message.timestamp + (message.durationMs ?? 0)
  )
  const copyText = contentToText(message.content)

  const statusLine = statusText
    ? (
        <Text type="supporting" color="secondary">
          {statusText}
          {thinking ? ' · 思考过程' : ''}
        </Text>
      )
    : undefined

  const metadata = hasBody
    ? (
        <HStack gap={2} vAlign="center" wrap="wrap">
          {tokens && (
            <HStack gap={1} vAlign="center">
              <Icon icon={CircleStackIcon} size="sm" color="secondary" />
              <Text type="supporting" color="secondary" hasTabularNumbers>
                用量 {tokens}
              </Text>
            </HStack>
          )}
          {localTime && (
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {localTime}
            </Text>
          )}
          <CopyButton text={copyText} />
        </HStack>
      )
    : undefined

  return (
    <ChatMessage sender="assistant" metadata={metadata}>
      <ChatMessageBubble variant="ghost" width="100%">
        <VStack gap={2} width="100%">
          {statusLine && thinking && (
            <ThinkingBlock content={thinking} trigger={statusLine} />
          )}
          {statusLine && !thinking && statusLine}
          {!thinking && hasRedactedThinking && (
            <Text type="supporting" color="secondary">
              思考过程已隐藏
            </Text>
          )}
          <MessageImages images={images} />
          {text && (
            <Markdown
              isStreaming={isStreaming}
              contentWidth="100%"
              codeLanguages={undefined}
            >
              {text}
            </Markdown>
          )}
          <ToolActivity message={message} executions={executions} />
          {stopNote && (
            <Text type="supporting" color="secondary">
              {stopNote}
            </Text>
          )}
          {message.errorMessage && (
            <Banner
              status="error"
              title="Pi 遇到错误"
              description={message.errorMessage}
            />
          )}
        </VStack>
      </ChatMessageBubble>
    </ChatMessage>
  )
}
