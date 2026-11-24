import { RectangleGroupIcon } from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { LayoutHeader } from '@astryxdesign/core/Layout'
import { HStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'

interface TopBarProps {
  title: string
  isSidebarCollapsed: boolean
  onSidebarCollapsedChange: (isCollapsed: boolean) => void
}

export function TopBar({
  title,
  isSidebarCollapsed,
  onSidebarCollapsedChange
}: TopBarProps): React.JSX.Element {
  return (
    <LayoutHeader height={52} padding={0} hasDivider>
      <HStack
        width="100%"
        height="100%"
        paddingInline={1}
        gap={1}
        vAlign="center"
        className="window-drag"
      >
        <Button
          label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          variant="ghost"
          size="sm"
          isIconOnly
          tooltip={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          icon={<Icon icon={RectangleGroupIcon} size="sm" />}
          className="window-no-drag"
          onClick={() => onSidebarCollapsedChange(!isSidebarCollapsed)}
        />
        <Text type="label" weight="semibold" maxLines={1}>
          {title}
        </Text>
      </HStack>
    </LayoutHeader>
  )
}
