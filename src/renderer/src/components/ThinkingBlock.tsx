import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Markdown } from '@astryxdesign/core/Markdown'
import { Text } from '@astryxdesign/core/Text'

export function ThinkingBlock({
  content
}: {
  content: string
}): React.JSX.Element {
  return (
    <Collapsible
      defaultIsOpen={false}
      trigger={
        <Text type="supporting" color="secondary">
          思考过程
        </Text>
      }
    >
      <Markdown density="compact" contentWidth="100%">
        {content}
      </Markdown>
    </Collapsible>
  )
}
