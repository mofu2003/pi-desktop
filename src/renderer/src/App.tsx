import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import {
  ChatLayout,
  ChatMessageList
} from '@astryxdesign/core/Chat'
import { Icon } from '@astryxdesign/core/Icon'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { useResizable } from '@astryxdesign/core/Resizable'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ChatEmptyState } from './components/ChatEmptyState'
import { Composer } from './components/Composer'
import { ComposerProjectPicker } from './components/ComposerProjectPicker'
import { CreateProjectDialog } from './components/CreateProjectDialog'
import { CustomizeScreen } from './components/CustomizeScreen'
import { ExtensionDialog } from './components/ExtensionDialog'
import { MessageView, RunningBashView, UserMessageBubble } from './components/MessageView'
import { Sidebar, type SidebarSessionAction } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { usePiSession } from './hooks/usePiSession'
import { useSidebarLibrary } from './hooks/useSidebarLibrary'
import type { ForkableMessage, ImageContent, ProjectInfo, SessionSummary } from '../../shared/types'
import { useUpdate } from './hooks/useUpdate'
import { LAYOUT_WIDTHS } from './lib/layout'
import { contentToText } from './lib/pi'

export default function App(): React.JSX.Element {
  const pi = usePiSession()
  const library = useSidebarLibrary(pi.project, pi.sessions, pi.unassignedWorkspace)
  const project = pi.project?.isUnassigned ? null
    : pi.project?.ssh ? pi.project
    : library.projects.find(({ path }) => path === pi.project?.path) ?? pi.project
  const update = useUpdate()
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ImageContent[]>([])
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isCustomizing, setIsCustomizing] = useState(false)
  const navigationPending = useRef(false)
  const [sessionAction, setSessionAction] = useState<{
    type: 'rename' | 'trash' | 'delete' | 'move'
    session: SessionSummary
    project: ProjectInfo
    target?: ProjectInfo
  } | null>(null)
  const [sessionName, setSessionName] = useState('')
  const [isSavingSessionAction, setIsSavingSessionAction] = useState(false)
  const [forkMessages, setForkMessages] = useState<ForkableMessage[] | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [sessionLinkSignal, setSessionLinkSignal] = useState(0)
  const sidebarResize = useResizable({
    defaultSize: 248,
    minSize: 196,
    maxSize: 400,
    autoSaveId: 'pi-desktop:session-sidebar'
  })

  useEffect(() => {
    return window.piDesktop.onMenuToggleSidebar(() => {
      setIsSidebarCollapsed((collapsed) => !collapsed)
    })
  }, [])

  useEffect(() => {
    if (!pi.editorPrefill) return
    setDraft(pi.editorPrefill.text)
  }, [pi.editorPrefill])

  const currentSession = pi.sessions.find(({ path }) => path === pi.activeSessionPath)
  const sessionAlias = pi.activeSessionPath ? library.sessionNames[pi.activeSessionPath] : undefined
  const title = useMemo(() => {
    if (pi.state?.sessionName) return pi.state.sessionName
    if (currentSession?.name) return currentSession.name
    if (sessionAlias) return sessionAlias
    const firstUserMessage = pi.messages.find(
      (message) => message.role === 'user'
    )
    if (firstUserMessage) {
      const firstLine = contentToText(firstUserMessage.content)
        .split('\n')[0]
        .trim()
      if (firstLine) return firstLine
    }
    return '新会话'
  }, [
    pi.state?.sessionName,
    currentSession,
    sessionAlias,
    pi.messages
  ])

  const lastAssistantTimestamp = useMemo(() => {
    for (let index = pi.messages.length - 1; index >= 0; index -= 1) {
      const message = pi.messages[index]
      if (message.role === 'assistant') return message.timestamp
    }
    return -1
  }, [pi.messages])

  const navigate = async (action: () => Promise<void>): Promise<void> => {
    if (navigationPending.current || pi.isConnecting) return
    navigationPending.current = true
    try {
      await action()
    } catch (error) {
      pi.reportError(error)
    } finally {
      navigationPending.current = false
    }
  }

  const handleNewSession = (target?: ProjectInfo) => navigate(async () => {
    const created = await pi.newSession(target ?? null)
    if (!created) return
    setDraft('')
    setAttachments([])
    setIsCustomizing(false)
  })

  const newSessionFromMenu = useEffectEvent(() => {
    void handleNewSession()
  })

  useEffect(() => {
    return window.piDesktop.onMenuNewSession(() => newSessionFromMenu())
  }, [])

  const handleOpenSession = (path: string, sourceProject?: ProjectInfo) => navigate(async () => {
    if (!await pi.openSession(path, sourceProject)) return
    if (path !== pi.activeSessionPath) {
      setDraft('')
      setAttachments([])
    }
    library.setSessionUnread(path, false)
    setIsCustomizing(false)
  })

  const openPendingSessionLink = useEffectEvent(() => {
    void navigate(async () => {
      const session = await window.piDesktop.takeSessionLink()
      if (!session) return
      const source = [library.unassignedWorkspace, ...library.projects]
        .find((item) => item?.path === session.cwd)
      if (!source) throw new Error('请先把此会话的工作目录添加到 Pi 项目。')
      if (!await pi.openSession(session.path, source)) return
      setDraft('')
      setAttachments([])
      setIsCustomizing(false)
      library.setSessionUnread(session.path, false)
    })
  })

  useEffect(() => window.piDesktop.onSessionLink(() => setSessionLinkSignal((signal) => signal + 1)), [])
  useEffect(() => {
    if (!pi.isConnecting && !pi.isStreaming && !pi.isRetrying && !pi.isBashRunning) openPendingSessionLink()
  }, [sessionLinkSignal, pi.isConnecting, pi.isStreaming, pi.isRetrying, pi.isBashRunning])

  const requestSessionAction = (
    type: SidebarSessionAction | 'trash',
    session: SessionSummary,
    sourceProject: ProjectInfo,
    target?: ProjectInfo
  ): void => {
    if (type === 'copy-cwd') {
      void window.piDesktop.copyText(sourceProject.path).catch(pi.reportError)
      return
    }
    if (type === 'copy-link') {
      void window.piDesktop.copyText(`pi-desktop://session/${encodeURIComponent(session.id)}`).catch(pi.reportError)
      return
    }
    if (type === 'markdown') {
      void window.piDesktop.copySessionMarkdown(sourceProject.path, session.path).catch(pi.reportError)
      return
    }
    if (type === 'share' || type === 'preview') {
      const operation = type === 'share'
        ? window.piDesktop.shareSession(sourceProject.path, session.path)
        : window.piDesktop.openSessionPreview(sourceProject.path, session.path, session.name || session.title)
      void operation.catch(pi.reportError)
      return
    }
    if (type === 'worktree') {
      void navigate(async () => {
        if (pi.isStreaming || pi.isRetrying || pi.isBashRunning) {
          throw new Error('请在会话运行结束后重试。')
        }
        const fork = await window.piDesktop.forkSessionInWorktree(sourceProject.path, session.path)
        library.addProject(fork.project)
        if (!await pi.openSession(fork.session.path, fork.project)) return
        setDraft('')
        setAttachments([])
        setIsCustomizing(false)
      })
      return
    }
    if (type === 'clone' || type === 'export') {
      void navigate(async () => {
        if (pi.isStreaming || pi.isRetrying || pi.isBashRunning) {
          throw new Error('请在会话运行结束后重试。')
        }
        if (!await pi.openSession(session.path, sourceProject)) return
        if (session.path !== pi.activeSessionPath || type === 'clone') {
          setDraft('')
          setAttachments([])
        }
        library.setSessionUnread(session.path, false)
        setIsCustomizing(false)
        if (type === 'clone') await pi.cloneSession()
        else await pi.exportSessionHtml()
      })
      return
    }
    setSessionName(session.name || library.sessionNames[session.path] || session.title)
    setSessionAction({ type, session, project: sourceProject, target })
  }

  const confirmSessionAction = () => navigate(async () => {
    if (!sessionAction) return
    const { type, session, project: sourceProject, target } = sessionAction
    if (type === 'rename') {
      const trimmed = sessionName.trim()
      if (!trimmed) return
      setIsSavingSessionAction(true)
      try {
        if (await pi.renameSession(session.path, trimmed, sourceProject)) {
          library.renameSession(session.path, trimmed)
          setSessionAction(null)
        }
      } finally {
        setIsSavingSessionAction(false)
      }
      return
    }
    setIsSavingSessionAction(true)
    try {
      if (type === 'move' && target) {
        const moved = await pi.moveSession(session.path, sourceProject, target)
        library.replaceSession({ session, sourceProject }, { session: moved, sourceProject: target })
        setSessionAction(null)
        return
      }
      const isRemovingActive = session.path === pi.activeSessionPath
      if (type === 'delete') await pi.deleteSession(session.path, sourceProject)
      else if (!await pi.trashSession(session.path, sourceProject)) return
      library.removeSession(session.path, sourceProject.path)
      setSessionAction(null)
      if (isRemovingActive) {
        setDraft('')
        setAttachments([])
        await pi.newSession(null)
      }
    } finally {
      setIsSavingSessionAction(false)
    }
  })

  const archiveProject = (sourceProject: ProjectInfo) => navigate(async () => {
    const sessions = await window.piDesktop.listSessions(sourceProject.path, { includeAll: true })
    library.archiveSessions(sessions.map((session) => ({ session, sourceProject })))
  })

  const actionLabel = sessionAction ? {
    rename: '重命名会话', trash: '移到废纸篓', delete: '永久删除会话', move: '移动会话'
  }[sessionAction.type] : ''
  const confirmLabel = sessionAction?.type === 'rename' ? '保存' : actionLabel

  const openForkDialog = () => navigate(async () => {
    const list = await pi.getForkMessages()
    setForkMessages(list)
  })

  const confirmFork = (entryId: string) => navigate(async () => {
    setIsForking(true)
    try {
      if (await pi.forkSession(entryId)) {
        setForkMessages(null)
        setIsCustomizing(false)
      }
    } finally {
      setIsForking(false)
    }
  })

  const handleSubmit = async (value: string, images: ImageContent[]): Promise<void> => {
    const trimmed = value.trim()
    if (trimmed === '/fork' && images.length === 0) {
      setDraft('')
      void openForkDialog()
      return
    }

    const submittedText = value
    const submittedImages = images
    setDraft('')
    setAttachments([])
    const accepted = await pi.send(submittedText, submittedImages)
    if (!accepted) {
      setDraft(submittedText)
      setAttachments(submittedImages)
    }
  }

  const hasConversation =
    pi.messages.length > 0 || Boolean(pi.optimisticUser) || Boolean(pi.runningBash)
  const canChooseProject = !hasConversation && !pi.isStreaming
  const chooseComposerProject = (target: ProjectInfo | null) => navigate(async () => {
    const isSame = Boolean(pi.state)
      && target?.path === project?.path
      && target?.ssh?.host === project?.ssh?.host
      && target?.ssh?.remoteCwd === project?.ssh?.remoteCwd
      && target?.ssh?.port === project?.ssh?.port
    if (!canChooseProject || isSame) return
    await pi.newSession(target)
  })
  const queuedCount = pi.queuedMessages.steering.length + pi.queuedMessages.followUp.length

  return (
    <VStack
      className="workspace-shell"
      height="100%"
      data-native-sidebar={window.piDesktop.platform === 'darwin'}
      data-sidebar-collapsed={isSidebarCollapsed || undefined}
      style={{
        '--pi-icon-rail-width': isSidebarCollapsed ? '0px' : '3rem',
        '--pi-session-sidebar-width': `${isSidebarCollapsed ? 0 : sidebarResize.size}px`
      } as CSSProperties}
    >
      <AppShell
        height="fill"
        contentPadding={0}
        variant="surface"
        topNav={
          <TopBar
            title={isCustomizing ? '' : title}
            projectName={!isCustomizing ? project?.name : undefined}
            isSidebarCollapsed={isSidebarCollapsed}
            isCustomizing={isCustomizing}
            update={update.update}
            onSidebarCollapsedChange={setIsSidebarCollapsed}
            onGoHome={() => setIsCustomizing(false)}
            onNewSession={() => void handleNewSession()}
            onCustomize={() => setIsCustomizing(true)}
            onOpenUpdate={() => void update.openUpdate()}
            onRenameSession={!isCustomizing && currentSession && pi.project
              ? () => requestSessionAction('rename', currentSession, pi.project!)
              : undefined}
            onForkSession={!isCustomizing && pi.state && pi.messages.length > 0
              ? () => void openForkDialog()
              : undefined}
            onCloneSession={!isCustomizing && pi.state && pi.messages.length > 0
              ? () => void navigate(async () => { await pi.cloneSession() })
              : undefined}
            onCopyLastAssistant={!isCustomizing && pi.state && pi.messages.length > 0
              ? () => void navigate(pi.copyLastAssistantText)
              : undefined}
            onExportSession={!isCustomizing && pi.state && pi.messages.length > 0
              ? () => void navigate(pi.exportSessionHtml)
              : undefined}
            onTrashSession={!isCustomizing && currentSession && pi.project
              ? () => requestSessionAction('trash', currentSession, pi.project!)
              : undefined}
          />
        }
        sideNav={
          isSidebarCollapsed ? undefined : (
            <Sidebar
              isCollapsed={isSidebarCollapsed}
              resizable={sidebarResize}
              isCustomizing={isCustomizing}
              onCustomize={() => setIsCustomizing(true)}
              onGoHome={() => setIsCustomizing(false)}
              library={library}
              activeSessionPath={pi.activeSessionPath}
              update={update.update}
              isConnecting={pi.isConnecting}
              onNewSession={(target) => void handleNewSession(target)}
              onCreateProject={() => setIsCreatingProject(true)}
              onOpenSession={(path, sourceProject) => void handleOpenSession(path, sourceProject)}
              onSessionAction={requestSessionAction}
              onArchiveProject={(sourceProject) => void archiveProject(sourceProject)}
              onRevealProject={(path) => void window.piDesktop.revealProject(path).catch(pi.reportError)}
              onRemoveProject={(path) => void navigate(async () => {
                await pi.forgetProject(path)
                library.removeProject(path)
                if (pi.project?.path === path) {
                  setDraft('')
                  setAttachments([])
                }
              })}
              onOpenUpdate={() => void update.openUpdate()}
            />
          )
        }
      >
        <Layout
          height="fill"
          contentWidth="100%"
          header={
            pi.error ? (
              <Banner
                status="error"
                title="Pi 遇到问题"
                description={pi.error}
                container="section"
                isDismissable
                onDismiss={pi.dismissError}
                dismissLabel="关闭错误提示"
              />
            ) : pi.notification ? (
              <Banner
                status={pi.notification.status}
                title="Pi"
                description={pi.notification.message}
                container="section"
                isDismissable
                onDismiss={pi.dismissNotification}
                dismissLabel="关闭通知"
              />
            ) : undefined
          }
          content={
            <LayoutContent
              padding={0}
              isScrollable={false}
              label={isCustomizing ? '自定义' : 'Pi 会话'}
            >
              {isCustomizing ? (
                <CustomizeScreen project={project?.ssh ? null : project} onBack={() => setIsCustomizing(false)} />
              ) : (
                <VStack height="100%" width="100%">
                  <ChatLayout
                    density="balanced"
                    emptyState={
                      <ChatEmptyState
                        projectName={project?.ssh ? (project.ssh.label || project.ssh.host) : project?.name}
                        isConnecting={pi.isConnecting}
                        isRuntimeConnected={pi.isRuntimeConnected}
                        onReconnect={() => void navigate(pi.reconnect)}
                      />
                    }
                    composer={pi.state || !hasConversation ? (
                      <Composer
                        projectPicker={canChooseProject ? (
                          <ComposerProjectPicker
                            project={project}
                            projects={library.projects}
                            isDisabled={pi.isConnecting}
                            onChange={(target) => void chooseComposerProject(target)}
                            onCreateProject={() => setIsCreatingProject(true)}
                          />
                        ) : undefined}
                        value={draft}
                        images={attachments}
                        models={pi.models}
                        commands={pi.commands}
                        status={pi.status}
                        commandStatuses={pi.commandStatuses}
                        widgets={pi.widgets}
                        queuedCount={queuedCount}
                        isRetrying={pi.isRetrying}
                        isBashRunning={pi.isBashRunning}
                        streamingBehavior={pi.streamingBehavior}
                        autoRetryEnabled={pi.autoRetryEnabled}
                        state={pi.state}
                        stats={pi.stats}
                        messages={pi.messages}
                        isConnecting={pi.isConnecting}
                        isStreaming={pi.isStreaming}
                        onChange={setDraft}
                        onAddImages={(next) => setAttachments((current) => [...current, ...next])}
                        onRemoveImage={(index) => setAttachments((current) => current.filter((_, idx) => idx !== index))}
                        onSubmit={(value, images) => void handleSubmit(value, images)}
                        onStop={() => void pi.stop()}
                        onClearQueue={async () => { await pi.clearQueue() }}
                        onAbortRetry={pi.abortRetry}
                        onStreamingBehaviorChange={pi.setStreamingBehavior}
                        onSetSteeringMode={pi.setSteeringMode}
                        onSetFollowUpMode={pi.setFollowUpMode}
                        onSetAutoCompaction={pi.setAutoCompaction}
                        onCompact={() => pi.compact()}
                        onSetAutoRetry={pi.setAutoRetry}
                        onSetModel={(provider, model) => pi.setModel(provider, model).catch(pi.reportError)}
                        onSetThinkingLevel={(level) => pi.setThinkingLevel(level).catch(pi.reportError)}
                      />
                    ) : undefined}
                  >
                    {hasConversation ? (
                      <VStack width="100%" hAlign="center" paddingInline={3}>
                        <VStack width="100%" maxWidth={LAYOUT_WIDTHS.chatColumn}>
                          <ChatMessageList
                            gap={6}
                            align="top"
                            density="balanced"
                            isStreaming={pi.isStreaming}
                          >
                            {pi.messages.map((message, index) => (
                              <MessageView
                                key={`${message.role}:${message.timestamp}`}
                                message={message}
                                messages={pi.messages}
                                messageIndex={index}
                                executions={pi.toolExecutions}
                                isStreaming={
                                  message.role === 'assistant'
                                    ? pi.isStreaming && message.timestamp === lastAssistantTimestamp
                                    : pi.isStreaming || pi.isRetrying
                                }
                                userEntryId={
                                  message.role === 'user'
                                    ? pi.userEntryIds[message.timestamp]
                                    : undefined
                                }
                                onRetractUserMessage={(entryId) => {
                                  void pi.retractUserMessage(entryId)
                                }}
                                onRevealFile={(path) => void window.piDesktop.revealFile(path).catch(pi.reportError)}
                              />
                            ))}
                            {pi.runningBash && (
                              <RunningBashView
                                command={pi.runningBash.command}
                                output={pi.runningBash.output}
                              />
                            )}
                            {pi.optimisticUser && (
                              <UserMessageBubble
                                text={pi.optimisticUser.text}
                                images={pi.optimisticUser.images}
                              />
                            )}
                          </ChatMessageList>
                        </VStack>
                      </VStack>
                    ) : undefined}
                  </ChatLayout>
                </VStack>
              )}
            </LayoutContent>
          }
        />
      </AppShell>
      {isCreatingProject && (
        <CreateProjectDialog
          projects={library.projects}
          onCreate={(createdProject) => {
            library.addProject(createdProject)
            setIsCreatingProject(false)
            if (canChooseProject) void chooseComposerProject(createdProject)
          }}
          onClose={() => setIsCreatingProject(false)}
        />
      )}
      <Dialog
        isOpen={Boolean(sessionAction)}
        onOpenChange={(open) => { if (!open && !isSavingSessionAction) setSessionAction(null) }}
        purpose="form"
      >
        <DialogHeader title={actionLabel} />
        <VStack padding={4} gap={3}>
          {sessionAction?.type === 'rename' ? (
            <TextInput
              label="会话名称"
              value={sessionName}
              onChange={setSessionName}
              onEnter={() => void confirmSessionAction()}
              hasAutoFocus
            />
          ) : sessionAction?.type === 'move' ? (
            <Text>将「{sessionName}」移到「{sessionAction.target?.name}」？之后 Pi 会在目标目录中运行此会话。</Text>
          ) : sessionAction?.type === 'delete' ? (
            <Text>永久删除「{sessionName}」？删除后无法恢复。</Text>
          ) : (
            <Text>将「{sessionName}」移到废纸篓？</Text>
          )}
          <HStack hAlign="end" gap={2}>
            <Button
              label="取消"
              variant="ghost"
              isDisabled={isSavingSessionAction}
              onClick={() => setSessionAction(null)}
            />
            <Button
              label={confirmLabel}
              variant={sessionAction?.type === 'delete' || sessionAction?.type === 'trash' ? 'destructive' : 'primary'}
              isDisabled={sessionAction?.type === 'rename' && !sessionName.trim()}
              isLoading={isSavingSessionAction}
              onClick={() => void confirmSessionAction()}
            />
          </HStack>
        </VStack>
      </Dialog>
      <Dialog
        isOpen={forkMessages !== null}
        onOpenChange={(open) => { if (!open && !isForking) setForkMessages(null) }}
        width={520}
        purpose="info"
      >
        <DialogHeader
          title="从历史消息分叉"
          subtitle="选择一条历史消息作为分叉起点，生成新会话。"
          onOpenChange={() => { if (!isForking) setForkMessages(null) }}
        />
        <VStack padding={4} gap={3}>
          {forkMessages && forkMessages.length > 0 ? (
            <ScrollableArea label="可分叉消息" axis="block" height="18rem">
              <List hasDividers edge="flush" density="compact">
                {forkMessages.map((item) => (
                  <ListItem
                    key={item.entryId}
                    label={item.text}
                    isDisabled={isForking}
                    endContent={<Icon icon={ChevronRightIcon} size="sm" color="secondary" />}
                    onClick={() => void confirmFork(item.entryId)}
                  />
                ))}
              </List>
            </ScrollableArea>
          ) : (
            <Text type="supporting" color="secondary">
              当前会话没有可用于分叉的用户消息。
            </Text>
          )}
          <HStack hAlign="end">
            <Button
              label="取消"
              variant="ghost"
              isDisabled={isForking}
              onClick={() => setForkMessages(null)}
            />
          </HStack>
        </VStack>
      </Dialog>
      <ExtensionDialog
        request={pi.extensionRequest}
        onRespond={pi.respondToExtension}
      />
    </VStack>
  )
}
