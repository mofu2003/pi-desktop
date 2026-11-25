import { Button } from '@astryxdesign/core/Button'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { PiMark } from './PiMark'

export function ChatEmptyState({
  projectName,
  isConnecting = false,
  isRuntimeConnected = true,
  onReconnect
}: {
  projectName?: string
  isConnecting?: boolean
  isRuntimeConnected?: boolean
  onReconnect?: () => void
}): React.JSX.Element {
  return (
    <VStack
      hAlign="center"
      vAlign="center"
      gap={3}
      height="100%"
      padding={8}
    >
      <PiMark size="lg" />
      <VStack hAlign="center" gap={1.5}>
        <Text type="display-3" as="h1" justify="center">
          {projectName ? `想用 Pi 在 ${projectName} 里做什么？` : '想用 Pi 做什么？'}
        </Text>
        <Text type="supporting" color="secondary" justify="center">
          输入 / 浏览命令 · ! 运行 Shell · ⌘N 新建会话
        </Text>
        {!isRuntimeConnected && (
          <HStack vAlign="center" gap={2}>
            <StatusDot
              variant={isConnecting ? 'accent' : 'error'}
              isPulsing={isConnecting}
              label={isConnecting ? '正在连接 Pi…' : 'Pi 未连接'}
            />
            <Text type="supporting" color="secondary" role="status">
              {isConnecting ? '正在连接 Pi…' : 'Pi 未连接'}
            </Text>
            {!isConnecting && onReconnect && (
              <Button label="重新连接" variant="ghost" size="sm" onClick={onReconnect} />
            )}
          </HStack>
        )}
      </VStack>
    </VStack>
  )
}
