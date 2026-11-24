import { FolderOpenIcon } from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Icon } from '@astryxdesign/core/Icon'
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { BrandBlock } from './BrandBlock'
import { PiMark } from './PiMark'

export function WelcomeScreen({
  onOpenProject,
  isOpening
}: {
  onOpenProject: () => void
  isOpening: boolean
}): React.JSX.Element {
  return (
    <VStack width="100%" height="100%" className="app-fade-in">
      <HStack
        width="100%"
        height={56}
        paddingInline={5}
        vAlign="center"
        className="window-drag"
        style={{ paddingInlineStart: '4.75rem' }}
      >
        <BrandBlock />
      </HStack>
      <StackItem size="fill">
        <VStack
          width="100%"
          height="100%"
          hAlign="center"
          vAlign="center"
          gap={5}
          padding={8}
        >
          <Card variant="muted" padding={4}>
            <PiMark size={36} />
          </Card>
          <VStack hAlign="center" gap={2} maxWidth={520}>
            <Text type="display-2" as="h1" justify="center">
              Pi 桌面版
            </Text>
            <Text
              type="large"
              color="secondary"
              justify="center"
            >
              打开项目即可启动 Pi 会话，沿用本机 Pi 的模型、技能、扩展和会话记录。
            </Text>
          </VStack>
          <Button
            label={isOpening ? '正在打开…' : '打开项目'}
            variant="primary"
            size="lg"
            icon={<Icon icon={FolderOpenIcon} size="sm" />}
            isLoading={isOpening}
            onClick={onOpenProject}
          />
          <Text type="supporting" color="secondary" justify="center">
            使用前请安装并配置 Pi 命令行工具。
          </Text>
        </VStack>
      </StackItem>
    </VStack>
  )
}
