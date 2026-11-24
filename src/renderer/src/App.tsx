import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Banner } from '@astryxdesign/core/Banner'
import {
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList
} from '@astryxdesign/core/Chat'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { ChatEmptyState } from './components/ChatEmptyState'
import { Composer } from './components/Composer'
import { ExtensionDialog } from './components/ExtensionDialog'
import { MessageView } from './components/MessageView'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { usePiSession } from './hooks/usePiSession'
import { contentToText, contextPercent } from './lib/pi'

export default function App(): React.JSX.Element {
  const pi = usePiSession()
  const [draft, setDraft] = useState('')
  const [isChoosingProject, setIsChoosingProject] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'b') {
        return
      }
      event.preventDefault()
      setIsSidebarCollapsed((collapsed) => !collapsed)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const title = useMemo(() => {
    if (pi.state?.sessionName) return pi.state.sessionName
    const currentSession = pi.sessions.find(
      (session) => session.path === pi.activeSessionPath
    )
    if (currentSession?.name) return currentSession.name
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
    pi.sessions,
    pi.activeSessionPath,
    pi.messages
  ])

  const lastAssistantTimestamp = useMemo(() => {
    for (let index = pi.messages.length - 1; index >= 0; index -= 1) {
      const message = pi.messages[index]
      if (message.role === 'assistant') return message.timestamp
    }
    return -1
  }, [pi.messages])

  const handleChooseProject = async (): Promise<void> => {
    if (isChoosingProject) return
    setIsChoosingProject(true)
    try {
      await pi.chooseProject()
    } finally {
      setIsChoosingProject(false)
    }
  }

  const handleNewSession = async (): Promise<void> => {
    setDraft('')
    await pi.newSession()
  }

  const handleOpenSession = async (path: string): Promise<void> => {
    setDraft('')
    await pi.openSession(path)
  }

  const handleSubmit = async (value: string): Promise<void> => {
    const submitted = value
    setDraft('')
    const accepted = await pi.send(submitted)
    if (!accepted) setDraft(submitted)
  }

  if (!pi.project) {
    return (
      <>
        <WelcomeScreen
          onOpenProject={() => void handleChooseProject()}
          isOpening={isChoosingProject}
        />
        <ExtensionDialog
          request={pi.extensionRequest}
          onRespond={pi.respondToExtension}
        />
      </>
    )
  }

  const contextUsage = contextPercent(pi.stats)
  const commandStatus = Object.values(pi.commandStatuses)[0]
  const hasConversation = pi.messages.length > 0 || Boolean(pi.optimisticUser)

  return (
    <>
      <AppShell
        height="fill"
        contentPadding={0}
        variant="surface"
        banner={
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
        sideNav={
          <Sidebar
            project={pi.project}
            sessions={pi.sessions}
            activeSessionPath={pi.activeSessionPath}
            state={pi.state}
            stats={pi.stats}
            isConnecting={pi.isConnecting}
            isStreaming={pi.isStreaming}
            commandStatus={commandStatus}
            isCollapsed={isSidebarCollapsed}
            onCollapsedChange={setIsSidebarCollapsed}
            onNewSession={() => void handleNewSession()}
            onOpenSession={(path) => void handleOpenSession(path)}
            onChooseProject={() => void handleChooseProject()}
          />
        }
      >
        <Layout
          height="fill"
          contentWidth="100%"
          header={
            <TopBar
              title={title}
              status={pi.status}
              isConnecting={pi.isConnecting}
              isStreaming={pi.isStreaming}
              hasError={Boolean(pi.error)}
              contextPercent={contextUsage}
              isSidebarCollapsed={isSidebarCollapsed}
            />
          }
          content={
            <LayoutContent
              padding={0}
              isScrollable={false}
              role="main"
              label="Pi 会话"
            >
              <ChatLayout
                density="balanced"
                style={{ height: '100%' }}
                emptyState={
                  <ChatEmptyState projectName={pi.project.name} />
                }
                composer={
                  <Composer
                    value={draft}
                    models={pi.models}
                    state={pi.state}
                    isConnecting={pi.isConnecting}
                    isStreaming={pi.isStreaming}
                    onChange={setDraft}
                    onSubmit={(value) => void handleSubmit(value)}
                    onStop={() => void pi.stop()}
                    onSetModel={(provider, modelId) =>
                      void pi.setModel(provider, modelId)
                    }
                    onSetThinkingLevel={(level) =>
                      void pi.setThinkingLevel(level)
                    }
                  />
                }
              >
                {hasConversation ? (
                  <ChatMessageList
                    gap={6}
                    align="top"
                    density="balanced"
                    isStreaming={pi.isStreaming}
                    className="chat-message-column"
                  >
                    {pi.messages.map((message) => (
                      <MessageView
                        key={`${message.role}:${message.timestamp}`}
                        message={message}
                        executions={pi.toolExecutions}
                        isStreaming={
                          pi.isStreaming &&
                          message.role === 'assistant' &&
                          message.timestamp === lastAssistantTimestamp
                        }
                      />
                    ))}
                    {pi.optimisticUser && (
                      <ChatMessage sender="user">
                        <ChatMessageBubble width="fit-content">
                          <Text type="body" style={{ whiteSpace: 'pre-wrap' }}>
                            {pi.optimisticUser}
                          </Text>
                        </ChatMessageBubble>
                      </ChatMessage>
                    )}
                  </ChatMessageList>
                ) : undefined}
              </ChatLayout>
            </LayoutContent>
          }
        />
      </AppShell>
      <ExtensionDialog
        request={pi.extensionRequest}
        onRespond={pi.respondToExtension}
      />
    </>
  )
}
