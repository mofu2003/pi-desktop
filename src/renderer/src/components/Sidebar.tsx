import { FolderOpenIcon, PlusIcon } from '@heroicons/react/24/outline'
import { HomeIcon } from '@heroicons/react/24/solid'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { ProjectInfo, SessionSummary } from '../../../shared/types'
import { formatRelativeTime } from '../lib/pi'

interface SidebarProps {
  isCollapsed: boolean
  onGoHome: () => void
  project: ProjectInfo | null
  sessions: SessionSummary[]
  activeSessionPath?: string
  onNewSession: () => void
  onChooseProject: () => void
  onOpenSession: (path: string) => void
}

export function Sidebar({
  isCollapsed,
  onGoHome,
  project,
  sessions,
  activeSessionPath,
  onNewSession,
  onChooseProject,
  onOpenSession
}: SidebarProps): React.JSX.Element {
  return (
    <HStack
      width={isCollapsed ? 48 : 296}
      height="100%"
      className="product-navigation"
    >
      <VStack
        as="nav"
        aria-label="主导航"
        width={48}
        height="100%"
        padding={1}
        hAlign="center"
        className="icon-rail"
      >
        <Stack height={44} />
        <Button
          label="主页"
          variant="secondary"
          size="md"
          isIconOnly
          tooltip="主页"
          icon={<Icon icon={HomeIcon} size="sm" />}
          aria-current="page"
          onClick={onGoHome}
        />
      </VStack>
      {!isCollapsed && (
        <SideNav
          id="session-sidebar"
          aria-label="项目与会话"
          className="sidebar-rail"
          style={{ width: 248 }}
          topContent={
            <VStack padding={1} gap={1}>
              {project && (
                <Button
                  label="新建会话"
                  variant="secondary"
                  size="md"
                  width="100%"
                  icon={<Icon icon={PlusIcon} size="sm" />}
                  onClick={onNewSession}
                />
              )}
              <Button
                label={project ? '切换项目' : '打开项目'}
                variant="ghost"
                size="sm"
                width="100%"
                icon={<Icon icon={FolderOpenIcon} size="sm" />}
                onClick={onChooseProject}
              />
            </VStack>
          }
        >
          <SideNavSection
            title={project ? `${project.name} · 最近会话` : '最近会话'}
          >
            {sessions.length > 0 ? (
              sessions.map((session) => (
                <SideNavItem
                  key={session.id}
                  label={session.name || session.preview}
                  isSelected={session.path === activeSessionPath}
                  endContent={
                    <Text type="supporting" color="secondary">
                      {formatRelativeTime(session.modified)}
                    </Text>
                  }
                  onClick={() => onOpenSession(session.path)}
                />
              ))
            ) : (
              <HStack paddingInline={2} paddingBlock={1}>
                <Text type="supporting" color="secondary">
                  暂无会话
                </Text>
              </HStack>
            )}
          </SideNavSection>
        </SideNav>
      )}
    </HStack>
  )
}
