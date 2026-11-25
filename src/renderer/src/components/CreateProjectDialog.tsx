import { FolderIcon, FolderPlusIcon } from '@heroicons/react/24/outline'
import { useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Icon } from '@astryxdesign/core/Icon'
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { ProjectInfo } from '../../../shared/types'

interface CreateProjectDialogProps {
  projects: ProjectInfo[]
  onCreate: (project: ProjectInfo) => void
  onClose: () => void
}

export function CreateProjectDialog({ projects, onCreate, onClose }: CreateProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<ProjectInfo | null>(null)
  const [pending, setPending] = useState<'choose' | 'create' | null>(null)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)

  async function perform(kind: 'choose' | 'create', action: () => Promise<void>): Promise<void> {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(kind)
    setError('')
    try {
      await action()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.replace(/^Error invoking remote method '.+?': (?:Error: )?/, ''))
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  const chooseFolder = () => perform('choose', async () => {
    const selected = await window.piDesktop.chooseProjectFolder()
    if (!selected) return
    setFolder(selected)
    setName((current) => current.trim() ? current : selected.name)
  })

  const create = () => perform('create', async () => {
    if (!name.trim()) return
    const existing = projects.find(({ path }) => path === folder?.path)
    if (existing) throw new Error(`此文件夹已添加为「${existing.name}」。`)
    onCreate(await window.piDesktop.createProject(name, folder?.path))
  })

  const changeOpen = (open: boolean): void => {
    if (!open && !pendingRef.current) onClose()
  }

  return (
    <Dialog isOpen onOpenChange={changeOpen} purpose="form" width="27rem">
      <DialogHeader title="创建项目" onOpenChange={changeOpen} />
      <VStack padding={4} gap={4}>
        <TextInput
          label="项目名称"
          value={name}
          onChange={setName}
          onEnter={() => void create()}
          startIcon={FolderIcon}
          hasAutoFocus
        />
        <VStack gap={2}>
          <Text type="label">源文件夹</Text>
          <HStack gap={2} hAlign="between" vAlign="center">
            <StackItem size="fill">
              <Text type="supporting" color="secondary" maxLines={1}>
                {folder?.path ?? '可选，留空时创建工作目录'}
              </Text>
            </StackItem>
            <Button
              label={folder ? '更换文件夹' : '添加文件夹'}
              icon={<Icon icon={FolderPlusIcon} size="sm" />}
              variant="secondary"
              size="sm"
              isLoading={pending === 'choose'}
              isDisabled={pending === 'create'}
              onClick={() => void chooseFolder()}
            />
          </HStack>
          {folder && (
            <HStack>
              <Button label="清除文件夹" variant="ghost" size="sm" isDisabled={Boolean(pending)} onClick={() => setFolder(null)} />
            </HStack>
          )}
        </VStack>
        {error && <Text type="supporting" role="alert">{error}</Text>}
        <HStack hAlign="end" gap={2}>
          <Button label="取消" variant="ghost" isDisabled={Boolean(pending)} onClick={onClose} />
          <Button
            label="创建项目"
            variant="primary"
            isDisabled={!name.trim() || pending === 'choose'}
            isLoading={pending === 'create'}
            onClick={() => void create()}
          />
        </HStack>
      </VStack>
    </Dialog>
  )
}
