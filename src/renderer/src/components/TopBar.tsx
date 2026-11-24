import {
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import { Icon } from '@astryxdesign/core/Icon'
import { LayoutHeader } from '@astryxdesign/core/Layout'
import { HStack, StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'

interface TopBarProps {
  title: string
  status: string | null
  isConnecting: boolean
  isStreaming: boolean
  hasError: boolean
  contextPercent?: number
  isSidebarCollapsed: boolean
}

export function TopBar({
  title,
  status,
  isConnecting,
  isStreaming,
  hasError,
  contextPercent,
  isSidebarCollapsed
}: TopBarProps): React.JSX.Element {
  const statusText = hasError
    ? '发生错误'
    : status || (isConnecting ? '连接中…' : isStreaming ? '运行中…' : '就绪')

  return (
    <LayoutHeader height={52} padding={0} hasDivider>
      <HStack
        width="100%"
        height="100%"
        paddingInlineStart={isSidebarCollapsed ? 10 : 4}
        paddingInlineEnd={4}
        vAlign="center"
        className="window-drag"
      >
        <StackItem size="fill">
          <Text type="label" weight="semibold" maxLines={1}>
            {title}
          </Text>
        </StackItem>
        <HStack gap={2} vAlign="center" className="window-no-drag">
          {contextPercent !== undefined && (
            <Text type="supporting" color="secondary">
              上下文 {contextPercent}%
            </Text>
          )}
          <HStack gap={1} vAlign="center">
            <Icon
              icon={hasError ? ExclamationTriangleIcon : CheckCircleIcon}
              size="sm"
              color={hasError ? 'error' : 'secondary'}
            />
            <Text
              type="supporting"
              color={hasError ? 'primary' : 'secondary'}
              maxLines={1}
            >
              {statusText}
            </Text>
          </HStack>
        </HStack>
      </HStack>
    </LayoutHeader>
  )
}
