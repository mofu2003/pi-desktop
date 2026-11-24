import { RectangleGroupIcon } from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
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
  const toggleLabel = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'

  return (
    <HStack
      as="header"
      width="100%"
      paddingInlineEnd={2}
      gap={2}
      vAlign="center"
      className="window-toolbar window-drag"
    >
      <HStack vAlign="center" className="window-toolbar-controls">
        <Button
          label={toggleLabel}
          variant="ghost"
          size="sm"
          isIconOnly
          tooltip={toggleLabel}
          icon={<Icon icon={RectangleGroupIcon} size="sm" />}
          className="window-no-drag"
          aria-expanded={!isSidebarCollapsed}
          aria-controls={isSidebarCollapsed ? undefined : 'session-sidebar'}
          onClick={() => onSidebarCollapsedChange(!isSidebarCollapsed)}
        />
      </HStack>
      <HStack paddingBlockStart={4} className="window-toolbar-title">
        <Text type="label" weight="semibold" maxLines={1}>
          {title}
        </Text>
      </HStack>
    </HStack>
  )
}
