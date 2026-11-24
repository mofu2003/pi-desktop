import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import {
  ChatToolCalls,
  type ChatToolCallItem
} from '@astryxdesign/core/Chat'
import type {
  AssistantMessage,
  ToolExecution
} from '../../../shared/types'
import { formatDuration, toolOutput, toolTarget } from '../lib/pi'

export function ToolActivity({
  message,
  executions
}: {
  message: AssistantMessage
  executions: Record<string, ToolExecution>
}): React.JSX.Element | null {
  const toolCalls = message.content.filter(
    (block): block is Extract<typeof block, { type: 'toolCall' }> =>
      block.type === 'toolCall'
  )
  if (toolCalls.length === 0) return null

  const calls: ChatToolCallItem[] = toolCalls.map((toolCall) => {
    const execution = executions[toolCall.id]
    const output = toolOutput(execution)
    const firstErrorLine = execution?.output.split('\n')[0]

    return {
      key: toolCall.id,
      name: toolCall.name,
      target: toolTarget(toolCall.name, toolCall.arguments),
      status: execution
        ? execution.isRunning
          ? 'running'
          : execution.isError
            ? 'error'
            : 'complete'
        : 'pending',
      duration: formatDuration(execution?.duration),
      errorMessage: execution?.isError ? firstErrorLine : undefined,
      resultDetail:
        output ? (
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
        ) : undefined
    }
  })

  return <ChatToolCalls calls={calls} />
}
