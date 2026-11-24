import {
  ArrowDownTrayIcon,
  Cog6ToothIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { HomeIcon } from '@heroicons/react/24/solid'
import { useId, useState, type ReactNode, type SVGProps } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { useCollapsible } from '@astryxdesign/core/Collapsible'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import type { ResizableRegion } from '@astryxdesign/core/Resizable'
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { AvailableUpdate, ProjectInfo, SessionSummary } from '../../../shared/types'
import { useSidebarLibrary } from '../hooks/useSidebarLibrary'

interface SidebarProps {
  isCollapsed: boolean
  resizable: ResizableRegion
  isChoosingProject: boolean
  onGoHome: () => void
  project: ProjectInfo | null
  sessions: SessionSummary[]
  activeSessionPath?: string
  update: AvailableUpdate | null
  onNewSession: () => void
  onChooseProject: () => void
  onOpenSession: (path: string, project: ProjectInfo) => void
  onOpenUpdate: () => void
}

function CustomizeIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <rect x="2.5" y="8" width="19" height="12" rx="2.5" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function SidebarDisclosure({
  label,
  folder = false,
  children,
  action
}: {
  label: string
  folder?: boolean
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  const { isOpen, toggle } = useCollapsible({ isCollapsible: true })
  const contentId = useId()

  return (
    <VStack gap={0}>
      <HStack vAlign="center" className="sidebar-disclosure-row">
        <button
          type="button"
          className="sidebar-disclosure"
          data-folder={folder || undefined}
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={toggle}
        >
          {folder && (
            <Icon icon={isOpen ? FolderOpenIcon : FolderIcon} size="sm" className="sidebar-folder-icon" />
          )}
          <Text
            type={folder ? 'body' : 'label'}
            size={folder ? undefined : 'sm'}
            weight={folder ? 'normal' : 'semibold'}
            color={folder ? 'primary' : 'secondary'}
            maxLines={1}
          >
            {label}
          </Text>
          <Icon icon={isOpen ? 'chevronDown' : 'chevronRight'} size="xsm" className="sidebar-chevron" />
        </button>
        {action}
      </HStack>
      <VStack id={contentId} className="sidebar-disclosure-content" hidden={!isOpen}>
        {children}
      </VStack>
    </VStack>
  )
}

function EmptySessions(): React.JSX.Element {
  return (
    <HStack className="sidebar-empty" vAlign="center">
      <Text type="supporting" color="secondary">暂无会话</Text>
    </HStack>
  )
}

export function Sidebar({
  isCollapsed,
  resizable,
  isChoosingProject,
  onGoHome,
  project,
  sessions,
  activeSessionPath,
  update,
  onNewSession,
  onChooseProject,
  onOpenSession,
  onOpenUpdate
}: SidebarProps): React.JSX.Element {
  const library = useSidebarLibrary(project, sessions)
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)
  const [groupName, setGroupName] = useState('')

  const allSessions = library.projects.flatMap((sourceProject) =>
    (library.sessionsByProject[sourceProject.path] ?? []).map((session) => ({ session, sourceProject }))
  )
  const sessionsByPath = new Map(allSessions.map((item) => [item.session.path, item]))
  const groupedPaths = new Set(library.groups.flatMap((group) => group.sessionPaths))
  const recent = allSessions.filter(({ session }) => !groupedPaths.has(session.path))
    .sort((a, b) => Date.parse(b.session.modified) - Date.parse(a.session.modified))

  const createGroup = (): void => {
    const name = groupName.trim()
    if (!name) return
    library.createGroup(name)
    setIsGroupDialogOpen(false)
  }

  const renderSession = (session: SessionSummary, sourceProject: ProjectInfo): React.JSX.Element => {
    const label = session.name || session.preview || session.title || '新会话'
    const groupId = library.groups.find((group) => group.sessionPaths.includes(session.path))?.id
    return (
      <SideNavItem
        key={session.path}
        label={label}
        size="sm"
        isSelected={session.path === activeSessionPath}
        onClick={() => onOpenSession(session.path, sourceProject)}
        actions={library.groups.length > 0 ? (
          <MoreMenu
            label={`整理「${label}」`}
            size="sm"
            placement="end"
            items={[
              ...library.groups.map((group) => ({
                id: group.id,
                label: `移到「${group.name}」`,
                isDisabled: group.id === groupId,
                onClick: () => library.moveSession(session.path, group.id)
              })),
              ...(groupId ? [{
                label: '移出分组',
                onClick: () => library.moveSession(session.path)
              }] : [])
            ]}
          />
        ) : undefined}
      />
    )
  }

  return (
    <HStack
      data-sidebar-expanded={!isCollapsed}
      height="100%"
      className="product-navigation"
    >
      <VStack
        as="nav"
        aria-label="主导航"
        height="100%"
        padding={1}
        paddingBlockStart={3}
        hAlign="center"
        vAlign="between"
        className="icon-rail"
      >
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
        <VStack gap={1} width="100%" hAlign="center">
          {update && (
            <Button
              label={`更新到 ${update.version}`}
              variant="primary"
              size="md"
              isIconOnly
              tooltip={`Pi ${update.version} 可用，点击下载`}
              icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
              onClick={onOpenUpdate}
            />
          )}
          <Button
            label="设置"
            variant="ghost"
            size="md"
            isIconOnly
            tooltip="设置"
            icon={<Icon icon={Cog6ToothIcon} size="sm" />}
          />
        </VStack>
      </VStack>
      {!isCollapsed && (
        <SideNav
          id="session-sidebar"
          aria-label="项目与会话"
          className="sidebar-rail"
          resizable={resizable}
          topContent={
            <VStack paddingBlock={1} gap={1}>
              <Button
                label="新建会话"
                variant="secondary"
                size="sm"
                width="100%"
                className="sidebar-action"
                icon={<Icon icon={PlusIcon} size="sm" />}
                isLoading={!project && isChoosingProject}
                onClick={onNewSession}
              />
              <Button
                label="自定义"
                variant="ghost"
                size="sm"
                width="100%"
                className="sidebar-action"
                icon={<Icon icon={CustomizeIcon} size="sm" />}
                onClick={() => {
                  setGroupName('')
                  setIsGroupDialogOpen(true)
                }}
              />
            </VStack>
          }
        >
          <VStack gap={5} className="sidebar-sections">
            {library.groups.map((group) => {
              const members = group.sessionPaths.flatMap((path) => {
                const member = sessionsByPath.get(path)
                return member ? [member] : []
              })
              return (
                <SidebarDisclosure key={group.id} label={group.name}>
                  {members.length ? members.map(({ session, sourceProject }) =>
                    renderSession(session, sourceProject)
                  ) : <EmptySessions />}
                </SidebarDisclosure>
              )
            })}
            <SidebarDisclosure
              label="项目"
              action={
                <Button
                  label="添加项目"
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  tooltip="添加项目"
                  className="sidebar-disclosure-action"
                  icon={<Icon icon={PlusIcon} size="sm" />}
                  isLoading={isChoosingProject}
                  onClick={onChooseProject}
                />
              }
            >
              {library.projects.length ? library.projects.map((sourceProject) => {
                const projectSessions = library.sessionsByProject[sourceProject.path] ?? []
                return (
                  <SidebarDisclosure key={sourceProject.path} label={sourceProject.name} folder>
                    <VStack className="sidebar-project-sessions">
                      {projectSessions.length ? projectSessions.map((session) =>
                        renderSession(session, sourceProject)
                      ) : <EmptySessions />}
                    </VStack>
                  </SidebarDisclosure>
                )
              }) : (
                <SideNavItem label="打开项目" size="sm" onClick={onChooseProject} />
              )}
            </SidebarDisclosure>
            <SidebarDisclosure label="最近">
              {recent.length ? recent.map(({ session, sourceProject }) =>
                renderSession(session, sourceProject)
              ) : <EmptySessions />}
            </SidebarDisclosure>
          </VStack>
        </SideNav>
      )}
      <Dialog isOpen={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen} purpose="form">
        <DialogHeader title="新建分组" onOpenChange={setIsGroupDialogOpen} />
        <VStack padding={4} gap={3}>
          <TextInput
            label="分组名称"
            value={groupName}
            onChange={setGroupName}
            onEnter={createGroup}
            hasAutoFocus
          />
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="ghost" onClick={() => setIsGroupDialogOpen(false)} />
            <Button label="创建" variant="primary" isDisabled={!groupName.trim()} onClick={createGroup} />
          </HStack>
        </VStack>
      </Dialog>
    </HStack>
  )
}
