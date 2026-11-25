import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Markdown } from '@astryxdesign/core/Markdown'
import { Text } from '@astryxdesign/core/Text'
import type { ReactNode } from 'react'

export function ThinkingBlock({
  content,
  trigger
}: {
  content: string
  trigger?: ReactNode
}): React.JSX.Element {
  return (
    <Collapsible
      defaultIsOpen={false}
      trigger={
        trigger ?? (
          <Text type="supporting" color="secondary">
            思考过程
          </Text>
        )
      }
    >
      <Markdown density="compact" contentWidth="100%">
        {content}
      </Markdown>
    </Collapsible>
  )
}
