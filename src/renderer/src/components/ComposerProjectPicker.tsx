import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Divider } from '@astryxdesign/core/Divider'
import { DropdownMenu, type DropdownMenuOption } from '@astryxdesign/core/DropdownMenu'
import { Icon } from '@astryxdesign/core/Icon'
import { List, ListItem } from '@astryxdesign/core/List'
import { Popover } from '@astryxdesign/core/Popover'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { normalizeSshTargetInput } from '../../../shared/ssh-target'
import type { ProjectInfo, SshHostInfo, SshTarget } from '../../../shared/types'

const CUSTOM_HOSTS_KEY = 'pi-desktop:custom-ssh-hosts'
const REMOTE_CWDS_KEY = 'pi-desktop:ssh-remote-cwds'

function loadStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function saveStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota errors in renderer preferences.
  }
}

function makeSshProject(ssh: SshTarget): ProjectInfo {
  const remoteCwd = ssh.remoteCwd?.trim() || '~'
  const label = ssh.label || ssh.host
  return {
    path: remoteCwd,
    name: remoteCwd === '~' ? label : `${label}:${remoteCwd}`,
    ssh: { ...ssh, label, remoteCwd }
  }
}

export function ComposerProjectPicker({
  project,
  projects,
  isDisabled,
  onChange,
  onCreateProject
}: {
  project: ProjectInfo | null
  projects: ProjectInfo[]
  isDisabled: boolean
  onChange: (project: ProjectInfo | null) => void
  onCreateProject: () => void
}): React.JSX.Element {
  const [isHostOpen, setIsHostOpen] = useState(false)
  const [isSshPanelOpen, setIsSshPanelOpen] = useState(false)
  const [configHosts, setConfigHosts] = useState<SshHostInfo[]>([])
  const [customHosts, setCustomHosts] = useState<SshHostInfo[]>(() => loadStoredJson(CUSTOM_HOSTS_KEY, []))
  const [remoteCwdsByHost, setRemoteCwdsByHost] = useState<Record<string, string[]>>(() =>
    loadStoredJson(REMOTE_CWDS_KEY, {})
  )
  const [sshQuery, setSshQuery] = useState('')
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [customHostInput, setCustomHostInput] = useState('')
  const [customRemoteCwdInput, setCustomRemoteCwdInput] = useState('~')
  const [customHostError, setCustomHostError] = useState<string | null>(null)
  const [cwdDialogOpen, setCwdDialogOpen] = useState(false)
  const [remoteCwdDraft, setRemoteCwdDraft] = useState('~')

  const activeSsh = project?.ssh
  const check = <Icon icon={CheckIcon} size="sm" />

  useEffect(() => {
    if (!isHostOpen) return
    void window.piDesktop.listSshHosts()
      .then((hosts) => setConfigHosts(hosts))
      .catch(() => setConfigHosts([]))
  }, [isHostOpen])

  const allSshHosts = useMemo(() => {
    const merged = new Map<string, SshHostInfo>()
    for (const host of configHosts) merged.set(host.name, host)
    for (const host of customHosts) {
      if (!merged.has(host.name)) merged.set(host.name, host)
    }
    return [...merged.values()]
  }, [configHosts, customHosts])

  const filteredSshHosts = useMemo(() => {
    const query = sshQuery.trim().toLowerCase()
    if (!query) return allSshHosts
    return allSshHosts.filter((host) =>
      host.name.toLowerCase().includes(query)
      || host.hostName?.toLowerCase().includes(query)
      || host.user?.toLowerCase().includes(query)
    )
  }, [allSshHosts, sshQuery])

  const selectLocalMachine = (): void => {
    setIsHostOpen(false)
    setIsSshPanelOpen(false)
    if (activeSsh) onChange(null)
  }

  const selectSshHost = (host: SshHostInfo): void => {
    const savedCwds = remoteCwdsByHost[host.name] ?? []
    const defaultCwd = savedCwds[0] || '~'
    setIsHostOpen(false)
    setIsSshPanelOpen(false)
    onChange(makeSshProject({
      host: host.name,
      label: host.name,
      port: host.port,
      remoteCwd: defaultCwd
    }))
  }

  const handleConnectCustomHost = (): void => {
    let parsed: ReturnType<typeof normalizeSshTargetInput>
    try {
      parsed = normalizeSshTargetInput(customHostInput)
    } catch (error) {
      setCustomHostError(error instanceof Error ? error.message : 'SSH 主机地址格式不正确')
      return
    }
    const remoteCwd = customRemoteCwdInput.trim() || '~'
    const entry: SshHostInfo = {
      name: parsed.host,
      port: parsed.port,
      source: 'custom'
    }
    const nextCustom = [entry, ...customHosts.filter((item) => item.name !== entry.name)].slice(0, 20)
    setCustomHosts(nextCustom)
    saveStoredJson(CUSTOM_HOSTS_KEY, nextCustom)

    const existingCwds = remoteCwdsByHost[entry.name] ?? []
    const nextCwds = [remoteCwd, ...existingCwds.filter((item) => item !== remoteCwd)].slice(0, 8)
    const nextMap = { ...remoteCwdsByHost, [entry.name]: nextCwds }
    setRemoteCwdsByHost(nextMap)
    saveStoredJson(REMOTE_CWDS_KEY, nextMap)

    setConnectDialogOpen(false)
    setCustomHostInput('')
    setCustomRemoteCwdInput('~')
    setCustomHostError(null)
    onChange(makeSshProject({
      host: parsed.host,
      label: parsed.label,
      port: parsed.port,
      remoteCwd
    }))
  }

  const applyRemoteCwd = (nextCwdRaw: string): void => {
    if (!activeSsh) return
    const nextCwd = nextCwdRaw.trim() || '~'
    const existingCwds = remoteCwdsByHost[activeSsh.host] ?? []
    const nextCwds = [nextCwd, ...existingCwds.filter((item) => item !== nextCwd)].slice(0, 8)
    const nextMap = { ...remoteCwdsByHost, [activeSsh.host]: nextCwds }
    setRemoteCwdsByHost(nextMap)
    saveStoredJson(REMOTE_CWDS_KEY, nextMap)
    setCwdDialogOpen(false)
    onChange(makeSshProject({ ...activeSsh, remoteCwd: nextCwd }))
  }

  const localProjectItems: DropdownMenuOption[] = [
    ...projects.map((item) => ({
      id: item.path,
      label: item.name,
      icon: FolderIcon,
      endContent: item.path === project?.path ? check : undefined,
      onClick: () => onChange(item)
    })),
    ...(projects.length > 0 ? [{ type: 'divider' as const }] : []),
    {
      id: 'create-project',
      label: '新建项目',
      icon: FolderPlusIcon,
      onClick: onCreateProject
    },
    {
      id: 'unassigned',
      label: '未关联项目',
      icon: FolderMinusIcon,
      endContent: project ? undefined : check,
      onClick: () => onChange(null)
    }
  ]

  const remoteCwd = activeSsh?.remoteCwd?.trim() || '~'
  const sshCwds = activeSsh
    ? [...new Set(['~', remoteCwd, ...(remoteCwdsByHost[activeSsh.host] ?? [])])]
    : []

  const sshProjectItems: DropdownMenuOption[] = activeSsh ? [
    ...sshCwds.map((dir) => ({
      id: `remote:${dir}`,
      label: dir === '~' ? '默认目录 (~)' : dir,
      icon: FolderIcon,
      endContent: dir === remoteCwd ? check : undefined,
      onClick: () => applyRemoteCwd(dir)
    })),
    { type: 'divider' as const },
    {
      id: 'custom-remote-cwd',
      label: '设置远端目录…',
      icon: FolderPlusIcon,
      onClick: () => {
        setRemoteCwdDraft(remoteCwd)
        setCwdDialogOpen(true)
      }
    }
  ] : []

  const hostPopoverContent = (
    <HStack gap={2} vAlign="start" className="host-picker-stage">
      <VStack className="host-picker-card" padding={1} gap={1}>
        <List density="compact" edge="flush">
          <ListItem
            label="此电脑"
            description="运行于 this machine"
            startContent={<Icon icon={ComputerDesktopIcon} size="sm" />}
            endContent={!activeSsh ? check : undefined}
            onClick={selectLocalMachine}
          />
        </List>
        <Divider />
        <List density="compact" edge="flush">
          <ListItem
            label="SSH 主机"
            startContent={<Icon icon={CommandLineIcon} size="sm" />}
            endContent={<Icon icon={ChevronRightIcon} size="sm" color="secondary" />}
            className={isSshPanelOpen ? 'host-picker-row-active' : undefined}
            onClick={() => setIsSshPanelOpen((open) => !open)}
          />
        </List>
      </VStack>
      {isSshPanelOpen && (
        <VStack className="host-picker-ssh-card" padding={0}>
          <VStack padding={1.5}>
            <TextInput
              type="search"
              label="搜索 SSH 主机"
              isLabelHidden
              placeholder="搜索主机..."
              startIcon={MagnifyingGlassIcon}
              size="sm"
              width="100%"
              value={sshQuery}
              onChange={setSshQuery}
              hasClear
              hasAutoFocus
            />
          </VStack>
          <Divider />
          <VStack padding={1.5} gap={1}>
            <VStack paddingInline={1.5} paddingBlock={0.5}>
              <Text type="supporting" color="secondary" weight="semibold">
                SSH 配置
              </Text>
            </VStack>
            {filteredSshHosts.length > 0 ? (
              <ScrollableArea
                label="SSH 主机列表"
                axis="block"
                style={{ maxHeight: '13.5rem' }}
              >
                <List density="compact" edge="flush">
                  {filteredSshHosts.map((host) => {
                    const detail = [host.user, host.hostName].filter(Boolean).join('@')
                    const isSelected = activeSsh?.host === host.name
                    return (
                      <ListItem
                        key={host.name}
                        label={host.name}
                        description={detail && detail !== host.name ? detail : undefined}
                        startContent={<Icon icon={CommandLineIcon} size="sm" />}
                        endContent={isSelected ? check : undefined}
                        onClick={() => selectSshHost(host)}
                      />
                    )
                  })}
                </List>
              </ScrollableArea>
            ) : (
              <VStack paddingInline={2} paddingBlock={2}>
                <Text type="supporting" color="secondary">
                  {allSshHosts.length === 0 ? '未在 ~/.ssh/config 中发现主机' : '没有匹配的 SSH 主机'}
                </Text>
              </VStack>
            )}
          </VStack>
          <Divider />
          <VStack padding={1}>
            <List density="compact" edge="flush">
              <ListItem
                label="连接到 SSH 主机..."
                startContent={<Icon icon={PlusIcon} size="sm" />}
                onClick={() => {
                  setIsHostOpen(false)
                  setIsSshPanelOpen(false)
                  setCustomHostError(null)
                  setConnectDialogOpen(true)
                }}
              />
            </List>
          </VStack>
        </VStack>
      )}
    </HStack>
  )

  return (
    <>
      <HStack
        width="100%"
        vAlign="center"
        gap={1.5}
        paddingInline={1}
        wrap="wrap"
        className="composer-project-bar"
      >
        <Popover
          label="选择运行主机"
          closeButtonLabel="关闭运行主机选择"
          placement="above"
          alignment="start"
          padding={0}
          className="host-picker-popover-shell"
          role="none"
          isOpen={isHostOpen}
          onOpenChange={(open) => {
            setIsHostOpen(open)
            if (open) {
              setSshQuery('')
              setIsSshPanelOpen(Boolean(activeSsh))
            } else {
              setIsSshPanelOpen(false)
            }
          }}
          isEnabled={!isDisabled}
          content={hostPopoverContent}
        >
          <Button
            label={activeSsh ? (activeSsh.label || activeSsh.host) : '此电脑'}
            icon={<Icon icon={activeSsh ? CommandLineIcon : ComputerDesktopIcon} size="sm" />}
            endContent={<Icon icon={ChevronDownIcon} size="xsm" color="secondary" />}
            variant="ghost"
            size="sm"
            className="composer-host-trigger"
            data-ssh={Boolean(activeSsh)}
            isDisabled={isDisabled}
          />
        </Popover>

        {activeSsh ? (
          <HStack vAlign="center" className="composer-project-selection" data-selected="true">
            <DropdownMenu
              placement="above"
              menuWidth="max-content"
              button={{
                label: remoteCwd === '~' ? '默认目录 (~)' : remoteCwd,
                icon: <Icon icon={FolderIcon} size="sm" />,
                endContent: <Icon icon={ChevronDownIcon} size="xsm" color="secondary" />,
                variant: 'ghost',
                size: 'sm',
                isDisabled
              }}
              items={sshProjectItems}
            />
          </HStack>
        ) : (
          <HStack vAlign="center" className="composer-project-selection" data-selected={Boolean(project)}>
            <DropdownMenu
              placement="above"
              menuWidth="max-content"
              button={{
                label: project?.name ?? '未关联项目',
                icon: project ? <Icon icon={FolderIcon} size="sm" /> : undefined,
                endContent: <Icon icon={ChevronDownIcon} size="xsm" color="secondary" />,
                variant: 'ghost',
                size: 'sm',
                isDisabled
              }}
              items={localProjectItems}
            />
          </HStack>
        )}
      </HStack>

      <Dialog
        isOpen={connectDialogOpen}
        onOpenChange={(open) => { if (!open) setConnectDialogOpen(false) }}
        purpose="form"
      >
        <DialogHeader
          title="连接到 SSH 主机"
          subtitle="输入 ~/.ssh/config 主机别名或 user@host，将通过本机 SSH 免密认证连接远端 Pi。"
        />
        <VStack padding={4} gap={3}>
          <TextInput
            label="SSH 主机"
            placeholder="例如：my-server 或 ubuntu@192.168.1.10"
            value={customHostInput}
            onChange={(next) => {
              setCustomHostInput(next)
              if (customHostError) setCustomHostError(null)
            }}
            onEnter={handleConnectCustomHost}
            status={customHostError ? { type: 'error', message: customHostError } : undefined}
            hasAutoFocus
          />
          <TextInput
            label="远端工作目录"
            placeholder="~"
            value={customRemoteCwdInput}
            onChange={setCustomRemoteCwdInput}
            onEnter={handleConnectCustomHost}
          />
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="ghost" onClick={() => setConnectDialogOpen(false)} />
            <Button
              label="连接"
              variant="primary"
              isDisabled={!customHostInput.trim()}
              onClick={handleConnectCustomHost}
            />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={cwdDialogOpen}
        onOpenChange={(open) => { if (!open) setCwdDialogOpen(false) }}
        purpose="form"
      >
        <DialogHeader
          title="设置远端工作目录"
          subtitle={activeSsh ? `主机：${activeSsh.label || activeSsh.host}` : undefined}
        />
        <VStack padding={4} gap={3}>
          <TextInput
            label="远端路径"
            placeholder="~/workspace 或 /home/user/project"
            value={remoteCwdDraft}
            onChange={setRemoteCwdDraft}
            onEnter={() => applyRemoteCwd(remoteCwdDraft)}
            hasAutoFocus
          />
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="ghost" onClick={() => setCwdDialogOpen(false)} />
            <Button
              label="应用"
              variant="primary"
              onClick={() => applyRemoteCwd(remoteCwdDraft)}
            />
          </HStack>
        </VStack>
      </Dialog>
    </>
  )
}
