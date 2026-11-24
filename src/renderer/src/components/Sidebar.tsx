import {
  ChatBubbleLeftRightIcon,
  FolderOpenIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { Icon } from '@astryxdesign/core/Icon'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { HStack, Stack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import type {
  PiSessionState,
  PiSessionStats,
  ProjectInfo,
  SessionSummary
} from '../../../shared/types'
import { contextPercent, formatRelativeTime, modelLabel } from '../lib/pi'
import { BrandBlock } from './BrandBlock'
import { PiMark } from './PiMark'

interface SidebarProps {
  project: ProjectInfo
  sessions: SessionSummary[]
  activeSessionPath?: string
  state: PiSessionState | null
  stats: PiSessionStats | null
  isConnecting: boolean
  isStreaming: boolean
  isCollapsed: boolean
  commandStatus?: string
  onCollapsedChange: (isCollapsed: boolean) => void
  onNewSession: () => void
  onOpenSession: (path: string) => void
  onChooseProject: () => void
}

export function Sidebar({
  project,
  sessions,
  activeSessionPath,
  state,
  stats,
  isConnecting,
  isStreaming,
  isCollapsed,
  commandStatus,
  onCollapsedChange,
  onNewSession,
  onOpenSession,
  onChooseProject
}: SidebarProps): React.JSX.Element {
  const percent = contextPercent(stats)
  const statusLabel = isConnecting
    ? '连接中'
    : isStreaming
      ? '运行中'
      : commandStatus || '就绪'

  const renderSession = (session: SessionSummary): React.JSX.Element => (
    <SideNavItem
      key={session.id}
      label={session.name || session.preview}
      isSelected={session.path === activeSessionPath}
      icon={
        <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
      }
      endContent={
        session.path === activeSessionPath ? undefined : (
          <Text type="supporting" color="secondary">
            {formatRelativeTime(session.modified)}
          </Text>
        )
      }
      onClick={() => onOpenSession(session.path)}
    />
  )

  return (
    <SideNav
      className="sidebar-rail"
      collapsible={{ isCollapsed, onCollapsedChange }}
      resizable={{ defaultWidth: 264, minWidth: 232, maxWidth: 336 }}
      header={
        isCollapsed ? (
          <Stack height={56} className="window-drag" />
        ) : (
          <VStack className="window-drag" gap={2} paddingBlockStart={1}>
            <Stack height={26} />
            <HStack
              hAlign="between"
              vAlign="center"
              width="100%"
              style={{ paddingInlineStart: '4.75rem' }}
            >
              <BrandBlock />
            </HStack>
            <VStack gap={0.5}>
              <Text type="label" maxLines={1}>
                {project.name}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {project.path}
              </Text>
            </VStack>
          </VStack>
        )
      }
      topContent={
        isCollapsed ? undefined : (
          <VStack gap={1} padding={2} className="window-no-drag">
            <Button
              label="新建会话"
              variant="secondary"
              size="md"
              width="100%"
              icon={<Icon icon={PlusIcon} size="sm" />}
              onClick={onNewSession}
            />
            <Button
              label="切换项目"
              variant="ghost"
              size="sm"
              width="100%"
              icon={<Icon icon={FolderOpenIcon} size="sm" />}
              onClick={onChooseProject}
            />
          </VStack>
        )
      }
      footer={
        isCollapsed ? undefined : (
          <VStack gap={2} padding={3} width="100%" className="window-no-drag">
            <Divider />
            <HStack gap={2} vAlign="center">
              <StatusDot
                variant={
                  isConnecting
                    ? 'warning'
                    : isStreaming
                      ? 'accent'
                      : 'success'
                }
                label={statusLabel}
                isPulsing={isConnecting || isStreaming}
              />
              <StackItem size="fill">
                <Text type="supporting" maxLines={1}>
                  {statusLabel}
                </Text>
              </StackItem>
              {percent !== undefined && (
                <Text type="supporting" color="secondary">
                  {percent}%
                </Text>
              )}
            </HStack>
            <HStack gap={1.5} vAlign="center">
              <PiMark size={16} />
              <Text type="supporting" color="secondary" maxLines={1}>
                {modelLabel(state?.model)}
              </Text>
            </HStack>
          </VStack>
        )
      }
    >
      {isCollapsed ? (
        sessions.map(renderSession)
      ) : (
        <SideNavSection
          title="最近会话"
          endContent={
            sessions.length > 0 ? (
              <Text type="supporting" color="secondary">
                {sessions.length}
              </Text>
            ) : undefined
          }
        >
          {sessions.length === 0 ? (
            <HStack paddingInline={2} paddingBlock={1}>
              <Text type="supporting" color="secondary">
                暂无会话
              </Text>
            </HStack>
          ) : (
            sessions.map(renderSession)
          )}
        </SideNavSection>
      )}
    </SideNav>
  )
}
