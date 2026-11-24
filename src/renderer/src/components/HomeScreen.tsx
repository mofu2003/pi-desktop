import { FolderOpenIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { ProjectInfo, SessionSummary } from '../../../shared/types'

interface HomeScreenProps {
  project: ProjectInfo | null
  sessions: SessionSummary[]
  isOpeningProject: boolean
  onOpenProject: () => void
  onSwitchProject: () => void
  onNewSession: () => void
  onOpenSession: (path: string) => void
}

export function HomeScreen({
  project,
  sessions,
  isOpeningProject,
  onOpenProject,
  onSwitchProject,
  onNewSession,
  onOpenSession
}: HomeScreenProps): React.JSX.Element {
  return (
    <VStack
      width="100%"
      height="100%"
      hAlign="center"
      vAlign="center"
      padding={8}
      className="home-screen app-fade-in"
    >
      <VStack width="100%" maxWidth={680} gap={5}>
        <VStack gap={1}>
          <Text type="display-2" as="h1">
            {project ? '继续和 Pi 一起工作' : '和 Pi 一起开始工作'}
          </Text>
          <Text type="large" color="secondary">
            {project
              ? `当前项目 · ${project.name}`
              : '打开一个项目，开始新的 Pi 会话。'}
          </Text>
        </VStack>

        <HStack gap={2} wrap="wrap" vAlign="center">
          {project ? (
            <>
              <Button
                label="新建会话"
                variant="primary"
                size="md"
                icon={<Icon icon={PlusIcon} size="sm" />}
                onClick={onNewSession}
              />
              <Button
                label="切换项目"
                variant="secondary"
                size="md"
                icon={<Icon icon={FolderOpenIcon} size="sm" />}
                isLoading={isOpeningProject}
                onClick={onSwitchProject}
              />
            </>
          ) : (
            <Button
              label="打开项目"
              variant="primary"
              size="md"
              icon={<Icon icon={FolderOpenIcon} size="sm" />}
              isLoading={isOpeningProject}
              onClick={onOpenProject}
            />
          )}
        </HStack>

        {project && sessions.length > 0 && (
          <VStack gap={1} className="home-recent-sessions">
            <Text type="label" color="secondary">
              最近会话
            </Text>
            {sessions.slice(0, 6).map((session) => (
              <Button
                key={session.id}
                label={session.name || session.preview}
                variant="ghost"
                width="100%"
                onClick={() => onOpenSession(session.path)}
              />
            ))}
          </VStack>
        )}
      </VStack>
    </VStack>
  )
}
