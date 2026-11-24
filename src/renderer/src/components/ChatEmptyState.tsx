import { Card } from '@astryxdesign/core/Card'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { PiMark } from './PiMark'

export function ChatEmptyState({
  projectName
}: {
  projectName: string
}): React.JSX.Element {
  return (
    <VStack
      hAlign="center"
      vAlign="center"
      gap={3}
      height="100%"
      padding={8}
      className="app-fade-in"
    >
      <Card variant="muted" padding={3}>
        <PiMark size={28} />
      </Card>
      <VStack hAlign="center" gap={1}>
        <Text type="display-3" as="h1" justify="center">
          想用 Pi 做什么？
        </Text>
        <Text type="large" color="secondary" justify="center">
          当前项目：{projectName}
        </Text>
      </VStack>
    </VStack>
  )
}
