import {
  ArchiveBoxArrowDownIcon,
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  ArrowDownTrayIcon,
  BookmarkIcon,
  BriefcaseIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  FolderIcon,
  FolderOpenIcon,
  ListBulletIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  WindowIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon } from '@heroicons/react/24/solid'
import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { ContextMenu, type ContextMenuOption } from '@astryxdesign/core/ContextMenu'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import type { ResizableRegion } from '@astryxdesign/core/Resizable'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { AvailableUpdate, ProjectInfo, SessionSummary } from '../../../shared/types'
import type { useSidebarLibrary } from '../hooks/useSidebarLibrary'

export type SidebarSessionAction = 'rename' | 'delete' | 'clone' | 'worktree' | 'markdown'
  | 'copy-cwd' | 'copy-link' | 'share' | 'preview' | 'export' | 'move'

interface SidebarProps {
  isCollapsed: boolean
  resizable: ResizableRegion
  isConnecting: boolean
  isCustomizing: boolean
  onCustomize: () => void
  onGoHome: () => void
  library: ReturnType<typeof useSidebarLibrary>
  activeSessionPath?: string
  update: AvailableUpdate | null
  onNewSession: (project?: ProjectInfo) => void
  onCreateProject: () => void
  onOpenSession: (path: string, project: ProjectInfo) => void
  onSessionAction: (type: SidebarSessionAction, session: SessionSummary, project: ProjectInfo, target?: ProjectInfo) => void
  onArchiveProject: (project: ProjectInfo) => void
  onRevealProject: (path: string) => void
  onRemoveProject: (path: string) => void
  onOpenUpdate: () => void
}

function EmptySessions(): React.JSX.Element {
  return (
    <VStack paddingInline={3} paddingBlock={1}>
      <Text type="supporting" color="secondary">暂无会话</Text>
    </VStack>
  )
}

export function Sidebar({
  isCollapsed,
  resizable,
  isConnecting,
  isCustomizing,
  onCustomize,
  onGoHome,
  library,
  activeSessionPath,
  update,
  onNewSession,
  onCreateProject,
  onOpenSession,
  onSessionAction,
  onArchiveProject,
  onRevealProject,
  onRemoveProject,
  onOpenUpdate
}: SidebarProps): React.JSX.Element {
  const [nameDialog, setNameDialog] = useState<{
    title: string
    onSave: (name: string) => void
  } | null>(null)
  const [nameInput, setNameInput] = useState('')
  const archivedPaths = new Set(library.archivedSessions.map(({ session }) => session.path))

  const sessionProjects = library.unassignedWorkspace
    ? [...library.projects, library.unassignedWorkspace]
    : library.projects
  const allSessions = sessionProjects.flatMap((sourceProject) =>
    (library.sessionsByProject[sourceProject.path] ?? [])
      .filter((session) => !archivedPaths.has(session.path))
      .map((session) => ({ session, sourceProject }))
  )
  const sessionsByPath = new Map(allSessions.map((item) => [item.session.path, item]))
  const groupedPaths = new Set(library.groups.flatMap((group) => group.sessionPaths))
  const recent = allSessions
    .filter(({ session, sourceProject }) => sourceProject.isUnassigned && !groupedPaths.has(session.path))
    .sort((a, b) => Date.parse(b.session.modified) - Date.parse(a.session.modified))

  const pinOrder = (paths: string[], first: string, second: string): number =>
    Number(paths.includes(second)) - Number(paths.includes(first))

  const projects = [...library.projects].sort((a, b) =>
    pinOrder(library.pinnedProjects, a.path, b.path)
  )

  const bySessionPin = (a: SessionSummary, b: SessionSummary): number =>
    pinOrder(library.pinnedSessions, a.path, b.path)

  const editName = (title: string, name: string, onSave: (name: string) => void): void => {
    setNameInput(name)
    setNameDialog({ title, onSave })
  }

  const saveName = (): void => {
    const name = nameInput.trim()
    if (!name || !nameDialog) return
    nameDialog.onSave(name)
    setNameDialog(null)
  }

  const sectionItems = (path: string, type: 'session' | 'project'): ContextMenuOption[] => {
    const groupId = library.groups.find((group) => (type === 'session'
      ? group.sessionPaths : group.projectPaths)?.includes(path))?.id
    const move = type === 'session' ? library.moveSession : library.moveProject
    const items: ContextMenuOption[] = library.groups.filter(({ id }) => id !== groupId)
      .map(({ id, name }) => ({ id, label: name, onClick: () => move(path, id) }))
    if (groupId) items.push({ label: '移出分区', onClick: () => move(path) })
    items.push({ label: '新建分区…', icon: PlusIcon, onClick: () =>
      editName('新建分区', '', (name) => library.createGroup(name, { path, type })) })
    return items
  }

  const renderSession = (session: SessionSummary, sourceProject: ProjectInfo, archived = false): React.JSX.Element => {
    const label = library.sessionNames[session.path] || session.name || session.preview || session.title || '新会话'
    const pinned = library.pinnedSessions.includes(session.path)
    const unread = library.unreadSessions.includes(session.path)
    const action = (type: SidebarSessionAction, target?: ProjectInfo) => () =>
      onSessionAction(type, session, sourceProject, target)
    const folders: ContextMenuOption[] = library.projects.filter(({ path }) => path !== sourceProject.path).map((target) => ({
      id: target.path, label: target.name, icon: FolderIcon, onClick: action('move', target)
    }))
    if (!sourceProject.isUnassigned && library.unassignedWorkspace) {
      folders.push({ label: '移出项目', icon: XMarkIcon, onClick: action('move', library.unassignedWorkspace) })
    }
    const togglePin = () => library.togglePin(session.path, 'pinnedSessions')
    const archive = () => archived
      ? library.restoreSession(session.path)
      : library.archiveSessions([{ session, sourceProject }])
    const pinLabel = pinned ? '取消置顶' : '置顶'
    const archiveLabel = archived ? '恢复会话' : '归档'
    const archiveIcon = archived ? ArchiveBoxIcon : ArchiveBoxArrowDownIcon
    const items: ContextMenuOption[] = archived ? [
      { label: archiveLabel, icon: archiveIcon, onClick: archive },
      { label: '永久删除…', icon: TrashIcon, variant: 'destructive', onClick: action('delete') }
    ] : [
      { label: '重命名', icon: PencilIcon, onClick: action('rename') },
      { label: pinLabel, icon: BookmarkIcon, onClick: togglePin },
      { label: unread ? '标记为已读' : '标记为未读', icon: EyeIcon,
        onClick: () => library.setSessionUnread(session.path, !unread) },
      ...(folders.length ? [{ label: '项目', icon: FolderIcon, items: folders }] : []),
      { label: '分区', icon: ListBulletIcon, items: sectionItems(session.path, 'session') },
      { type: 'divider' },
      { label: '分叉', icon: ArrowsRightLeftIcon, items: [
        { label: '创建聊天分支', onClick: action('clone') },
        { label: '在新工作树中创建聊天分支', isDisabled: sourceProject.isUnassigned, onClick: action('worktree') }
      ] },
      { type: 'divider' },
      { label: '分享…', icon: ShareIcon, onClick: action('share') },
      { label: '复制', icon: ClipboardDocumentIcon, items: [
        { label: '复制深度链接', icon: ClipboardDocumentIcon, onClick: action('copy-link') },
        { label: '复制为 Markdown', icon: ClipboardDocumentIcon, onClick: action('markdown') },
        { label: '复制工作目录', icon: ClipboardDocumentIcon, onClick: action('copy-cwd') }
      ] },
      { label: '导出 HTML…', icon: ArrowDownTrayIcon, onClick: action('export') },
      { type: 'divider' },
      { label: '在新窗口查看', icon: WindowIcon, onClick: action('preview') },
      { type: 'divider' },
      { label: archiveLabel, icon: archiveIcon, onClick: archive },
      { label: '永久删除…', icon: TrashIcon, variant: 'destructive', onClick: action('delete') }
    ]
    const isSelected = session.path === activeSessionPath

    return (
      <ContextMenu key={session.path} label={`${label} 会话菜单`} items={items}
        size="sm" menuWidth="15rem" style={{ maxHeight: 'min(75dvh, 28rem)' }}
        onContextMenu={(event) => event.stopPropagation()}>
        <SideNavItem
          label={label}
          size="sm"
          isSelected={isSelected}
          endContent={unread && <StatusDot variant="accent" label="未读" />}
          onClick={() => onOpenSession(session.path, sourceProject)}
          actions={
            <HStack className="sidebar-row-actions">
              {!archived && <Button label={pinLabel} variant="ghost" size="sm" isIconOnly
                tooltip={pinLabel} icon={<Icon icon={BookmarkIcon} size="sm" />} onClick={togglePin} />}
              <Button label={archiveLabel} variant="ghost" size="sm" isIconOnly
                tooltip={archiveLabel} icon={<Icon icon={archiveIcon} size="sm" />} onClick={archive} />
              <MoreMenu
                label={`「${label}」的会话操作`}
                size="sm"
                placement="end"
                items={items}
              />
            </HStack>
          }
        />
      </ContextMenu>
    )
  }

  const renderProject = (sourceProject: ProjectInfo): React.JSX.Element => {
    const { path, name } = sourceProject
    const projectSessions = (library.sessionsByProject[path] ?? [])
      .filter((session) => !archivedPaths.has(session.path) && !groupedPaths.has(session.path))
      .sort(bySessionPin)
    const items: ContextMenuOption[] = [
      { label: '在此项目新建会话', icon: PlusIcon, onClick: () => onNewSession(sourceProject) },
      {
        label: library.pinnedProjects.includes(path) ? '取消置顶' : '置顶',
        icon: BookmarkIcon,
        onClick: () => library.togglePin(path, 'pinnedProjects')
      },
      { label: '编辑名称…', icon: PencilIcon, onClick: () =>
        editName('编辑项目', name, (next) => library.renameProject(path, next)) },
      { type: 'divider' },
      { label: '分区', icon: ListBulletIcon, items: sectionItems(path, 'project') },
      { label: '在访达中显示', icon: FolderOpenIcon, onClick: () => onRevealProject(path) },
      { label: '归档项目会话', icon: ArchiveBoxArrowDownIcon, onClick: () => onArchiveProject(sourceProject) },
      { type: 'divider' },
      { label: '移除项目', icon: XMarkIcon, onClick: () => onRemoveProject(path) }
    ]
    return (
      <ContextMenu key={path} label={`${name} 项目菜单`} items={items}
        size="sm" menuWidth="15rem" onContextMenu={(event) => event.stopPropagation()}>
        <SideNavItem
          label={name}
          icon={FolderIcon}
          selectedIcon={FolderOpenIcon}
          size="sm"
          collapsible
          actions={
            <HStack className="sidebar-row-actions">
              <MoreMenu label={`「${name}」的项目操作`} size="sm" placement="end" items={items} />
            </HStack>
          }
        >
          {projectSessions.length ? projectSessions.map((session) =>
            renderSession(session, sourceProject)
          ) : <EmptySessions />}
        </SideNavItem>
      </ContextMenu>
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
          label="对话"
          variant={isCustomizing ? 'ghost' : 'secondary'}
          size="md"
          isIconOnly
          tooltip="对话"
          icon={<Icon icon={isCustomizing ? ChatBubbleLeftRightIcon : ChatBubbleLeftRightSolidIcon} size="sm" />}
          aria-current={isCustomizing ? undefined : 'page'}
          onClick={onGoHome}
        />
        {update && (
          <Button
            label={`更新到 ${update.version}`}
            variant="primary"
            size="md"
            isIconOnly
            tooltip={`Pi ${update.version} 可用，点击更新`}
            icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
            onClick={onOpenUpdate}
          />
        )}
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
                isLoading={isConnecting}
                onClick={() => onNewSession()}
              />
              <Button
                label="自定义"
                variant={isCustomizing ? 'secondary' : 'ghost'}
                size="sm"
                width="100%"
                className="sidebar-action"
                aria-current={isCustomizing ? 'page' : undefined}
                icon={<Icon icon={BriefcaseIcon} size="sm" />}
                onClick={onCustomize}
              />
            </VStack>
          }
        >
          <VStack gap={4}>
            {library.groups.map((group, index) => {
              const members = group.sessionPaths.flatMap((path) => {
                const member = sessionsByPath.get(path)
                return member ? [member] : []
              }).sort((a, b) => bySessionPin(a.session, b.session))
              const sectionProjects = projects.filter(({ path }) => group.projectPaths?.includes(path))
              const items: ContextMenuOption[] = [
                { label: '重命名分区…', icon: PencilIcon, onClick: () =>
                  editName('重命名分区', group.name, (name) => library.editGroup(group.id, name)) },
                { label: '上移分区', isDisabled: index === 0, onClick: () => library.reorderGroup(group.id, -1) },
                { label: '下移分区', isDisabled: index === library.groups.length - 1,
                  onClick: () => library.reorderGroup(group.id, 1) },
                { label: '移除分区', icon: XMarkIcon, onClick: () => library.editGroup(group.id) }
              ]
              return (
                <ContextMenu key={group.id} label={`${group.name} 分区菜单`} items={items} size="sm">
                  <SideNavSection title={group.name} endContent={
                    <MoreMenu label={`「${group.name}」的分区操作`} size="sm" placement="end" items={items} />
                  }>
                    {sectionProjects.map(renderProject)}
                    {members.map(({ session, sourceProject }) => renderSession(session, sourceProject))}
                    {!members.length && !sectionProjects.length && <EmptySessions />}
                  </SideNavSection>
                </ContextMenu>
              )
            })}

            <SideNavSection
              title="项目"
              endContent={
                <Button
                  label="创建项目"
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  tooltip="创建项目"
                  icon={<Icon icon={PlusIcon} size="sm" />}
                  onClick={onCreateProject}
                />
              }
            >
              {projects.filter(({ path }) => !library.groups.some((group) => group.projectPaths?.includes(path)))
                .map(renderProject)}
            </SideNavSection>

            <SideNavSection title="最近">
              {recent.length ? recent.sort((a, b) => bySessionPin(a.session, b.session)).map(({ session, sourceProject }) =>
                renderSession(session, sourceProject)
              ) : <EmptySessions />}
            </SideNavSection>
            <SideNavItem label="归档" icon={ArchiveBoxIcon} size="sm" collapsible={{ defaultIsCollapsed: true }}>
              {library.archivedSessions.length
                ? library.archivedSessions.map(({ session, sourceProject }) => renderSession(session, sourceProject, true))
                : <EmptySessions />}
            </SideNavItem>
          </VStack>
        </SideNav>
      )}
      <Dialog isOpen={Boolean(nameDialog)} onOpenChange={(open) => { if (!open) setNameDialog(null) }} purpose="form">
        <DialogHeader title={nameDialog?.title ?? ''} />
        <VStack padding={4} gap={3}>
          <TextInput
            label="名称"
            value={nameInput}
            onChange={setNameInput}
            onEnter={saveName}
            hasAutoFocus
          />
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="ghost" onClick={() => setNameDialog(null)} />
            <Button label="保存" variant="primary" isDisabled={!nameInput.trim()} onClick={saveName} />
          </HStack>
        </VStack>
      </Dialog>
    </HStack>
  )
}
