import {
  ArrowDownTrayIcon,
  ArrowUpOnSquareIcon,
  BriefcaseIcon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  DocumentDuplicateIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  RectangleGroupIcon,
  TrashIcon
} from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu, type MoreMenuProps } from '@astryxdesign/core/MoreMenu'
import { HStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { AvailableUpdate } from '../../../shared/types'

interface TopBarProps {
  title: string
  projectName?: string
  isSidebarCollapsed: boolean
  isCustomizing: boolean
  update: AvailableUpdate | null
  onSidebarCollapsedChange: (isCollapsed: boolean) => void
  onGoHome: () => void
  onNewSession: () => void
  onCustomize: () => void
  onOpenUpdate: () => void
  onRenameSession?: () => void
  onForkSession?: () => void
  onCloneSession?: () => void
  onExportSession?: () => void
  onCopyLastAssistant?: () => void
  onTrashSession?: () => void
}

export function TopBar({
  title,
  projectName,
  isSidebarCollapsed,
  isCustomizing,
  update,
  onSidebarCollapsedChange,
  onGoHome,
  onNewSession,
  onCustomize,
  onOpenUpdate,
  onRenameSession,
  onForkSession,
  onCloneSession,
  onExportSession,
  onCopyLastAssistant,
  onTrashSession
}: TopBarProps): React.JSX.Element {
  const toggleLabel = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'
  const sessionItems: MoreMenuProps['items'] = []

  if (onRenameSession) {
    sessionItems.push({ label: '重命名', icon: PencilIcon, onClick: onRenameSession })
  }
  if (onForkSession) {
    sessionItems.push({ label: '从历史消息分叉…', icon: ChevronRightIcon, onClick: onForkSession })
  }
  if (onCloneSession) {
    sessionItems.push({ label: '克隆会话', icon: DocumentDuplicateIcon, onClick: onCloneSession })
  }
  if (onCopyLastAssistant) {
    sessionItems.push({ label: '复制最后一条回复', icon: ClipboardDocumentIcon, onClick: onCopyLastAssistant })
  }
  if (onExportSession) {
    sessionItems.push({ label: '导出为 HTML…', icon: ArrowUpOnSquareIcon, onClick: onExportSession })
  }
  if (onTrashSession) {
    if (sessionItems.length > 0) sessionItems.push({ type: 'divider' })
    sessionItems.push({
      label: '移到废纸篓…',
      icon: TrashIcon,
      variant: 'destructive',
      onClick: onTrashSession
    })
  }

  return (
    <HStack
      as="header"
      width="100%"
      paddingInlineEnd={6}
      vAlign="center"
      className="window-toolbar window-drag"
    >
      <HStack vAlign="center" gap={1} className="window-toolbar-controls">
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
        {isSidebarCollapsed && (
          <>
            <Button
              label="新建会话"
              variant="ghost"
              size="sm"
              isIconOnly
              tooltip="新建会话"
              icon={<Icon icon={PlusIcon} size="sm" />}
              className="window-no-drag"
              onClick={onNewSession}
            />
            <Button
              label="对话"
              variant={isCustomizing ? 'ghost' : 'secondary'}
              size="sm"
              isIconOnly
              tooltip="对话"
              icon={<Icon icon={ChatBubbleLeftRightIcon} size="sm" />}
              className="window-no-drag"
              onClick={onGoHome}
            />
            <Button
              label="自定义"
              variant={isCustomizing ? 'secondary' : 'ghost'}
              size="sm"
              isIconOnly
              tooltip="自定义"
              icon={<Icon icon={BriefcaseIcon} size="sm" />}
              className="window-no-drag"
              onClick={onCustomize}
            />
            {update && (
              <Button
                label={`更新到 ${update.version}`}
                variant="primary"
                size="sm"
                isIconOnly
                tooltip={`Pi ${update.version} 可用，点击更新`}
                icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
                className="window-no-drag"
                onClick={onOpenUpdate}
              />
            )}
          </>
        )}
      </HStack>
      <HStack paddingInlineStart={4} vAlign="center" gap={3} className="window-toolbar-title">
        {projectName && (
          <Icon
            icon={FolderIcon}
            size="sm"
            label={`项目：${projectName}`}
            className="window-project-icon"
          />
        )}
        <Text type="label" weight="semibold" maxLines={1} className="window-toolbar-label">
          {title}
        </Text>
        {sessionItems.length > 0 && (
          <HStack className="window-no-drag window-toolbar-actions">
            <MoreMenu
              label="当前会话操作"
              size="sm"
              items={sessionItems}
            />
          </HStack>
        )}
      </HStack>
    </HStack>
  )
}
