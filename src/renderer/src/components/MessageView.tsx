import { Banner } from '@astryxdesign/core/Banner'
import {
  ChatMessage,
  ChatMessageBubble,
  ChatSystemMessage
} from '@astryxdesign/core/Chat'
import { Markdown } from '@astryxdesign/core/Markdown'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type {
  AgentMessage,
  ToolExecution
} from '../../../shared/types'
import { contentToText } from '../lib/pi'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolActivity } from './ToolActivity'

export function MessageView({
  message,
  executions,
  isStreaming
}: {
  message: AgentMessage
  executions: Record<string, ToolExecution>
  isStreaming: boolean
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
    return (
      <ChatSystemMessage>
        <Text type="code" color="secondary">
          $ {message.command}
        </Text>
      </ChatSystemMessage>
    )
  }

  if (message.role === 'custom') {
    if (!message.display) return null
    return (
      <ChatSystemMessage>
        <Text type="supporting" color="secondary">
          {contentToText(message.content)}
        </Text>
      </ChatSystemMessage>
    )
  }

  if (message.role === 'user') {
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble width="fit-content">
          <Text type="body" style={{ whiteSpace: 'pre-wrap' }}>
            {contentToText(message.content)}
          </Text>
        </ChatMessageBubble>
      </ChatMessage>
    )
  }

  if (message.role !== 'assistant') return null

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
  const hasTools = message.content.some((block) => block.type === 'toolCall')

  if (!text && !thinking && !hasTools && !message.errorMessage) return null

  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble variant="ghost" width="100%">
        <VStack gap={2} width="100%" className="message-markdown">
          {thinking && <ThinkingBlock content={thinking} />}
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
