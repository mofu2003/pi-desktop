import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BookOpenIcon,
  CubeIcon,
  ChevronRightIcon,
  LinkIcon
} from '@heroicons/react/24/outline'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { List, ListItem } from '@astryxdesign/core/List'
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { CustomizationResource, ProjectInfo } from '../../../shared/types'
import { CustomizationDetailScreen } from './CustomizationDetailScreen'

const tabs = [
  { kind: 'skills', label: '技能', icon: BookOpenIcon, empty: '暂无已发现的技能' },
  { kind: 'mcp', label: 'MCP', icon: LinkIcon, empty: '暂无已配置的 MCP 服务器' },
  { kind: 'extensions', label: '扩展与扩展包', icon: CubeIcon, empty: '暂无已配置的扩展或扩展包' }
] as const

const scopes = [
  { id: 'user', label: '个人' },
  { id: 'project', label: '当前项目' }
] as const

export function CustomizeScreen({
  project,
  onBack
}: {
  project: ProjectInfo | null
  onBack: () => void
}): React.JSX.Element {
  const [kind, setKind] = useState<CustomizationResource['kind']>('skills')
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [resources, setResources] = useState<CustomizationResource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [selected, setSelected] = useState<CustomizationResource>()
  const list = useRef<HTMLElement>(null)
  const scrollTop = useRef(0)
  const path = project?.path

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError('')
    setActionError('')
    void window.piDesktop.listCustomization(path).then((entries) => {
      if (!cancelled) setResources(entries)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '无法读取 Pi 自定义资源。')
    }).finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [path, refresh])

  useEffect(() => {
    setSelected(undefined)
    scrollTop.current = 0
  }, [path])

  useLayoutEffect(() => {
    if (!selected && list.current) list.current.scrollTop = scrollTop.current
  }, [selected])

  const reveal = async (id: string): Promise<void> => {
    setActionError('')
    try {
      if (await window.piDesktop.revealCustomization(id)) return
    } catch {
      // The location may no longer be available after reloading resources.
    }
    setActionError('无法显示该资源，请刷新后重试。')
  }

  const activeTab = tabs.find((tab) => tab.kind === kind) ?? tabs[0]
  const query = search.trim().toLowerCase()
  const visible = resources.filter((entry) => entry.kind === kind &&
    `${entry.name} ${entry.description ?? ''}`.toLowerCase().includes(query))

  if (selected) {
    return (
      <CustomizationDetailScreen
        key={selected.id}
        resource={selected}
        onBack={() => {
          setSelected(undefined)
          setActionError('')
        }}
        onReveal={() => void reveal(selected.id)}
        actionError={actionError}
      />
    )
  }

  return (
    <VStack ref={list} height="100%" isScrollable>
      <VStack width="100%" maxWidth={960} padding={6} gap={5} className="customize-page">
        <HStack hAlign="between" vAlign="center" gap={2}>
          <VStack gap={1}>
            <Heading level={1} weight="semibold">自定义</Heading>
            <Text type="supporting" color="secondary">
              {project ? `当前项目 · ${project.name}` : '个人资源'}
            </Text>
          </VStack>
          <Button
            label="返回"
            variant="ghost"
            size="sm"
            icon={<Icon icon={ArrowLeftIcon} size="sm" />}
            onClick={onBack}
          />
        </HStack>

        <VStack gap={3}>
          <TabList
            role="tablist"
            aria-label="自定义资源"
            value={kind}
            onChange={(value) => {
              const target = tabs.find((tab) => tab.kind === value)
              if (target) setKind(target.kind)
            }}
            hasDivider
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.kind}
                id={`customize-tab-${tab.kind}`}
                value={tab.kind}
                label={tab.label}
                panelId={`customize-panel-${tab.kind}`}
                icon={<Icon icon={tab.icon} size="sm" />}
              />
            ))}
          </TabList>
          <HStack gap={2} vAlign="center">
            <Stack width="100%" maxWidth={340}>
              <TextInput
                label={`搜索${activeTab.label}`}
                isLabelHidden
                value={search}
                onChange={setSearch}
                placeholder={`搜索${activeTab.label}`}
                startIcon="search"
              />
            </Stack>
            <Button
              label="刷新资源"
              variant="ghost"
              size="md"
              isIconOnly
              tooltip="刷新资源"
              isLoading={isLoading}
              icon={<Icon icon={ArrowPathIcon} size="sm" />}
              onClick={() => setRefresh((version) => version + 1)}
            />
          </HStack>
        </VStack>

        <VStack
          id={`customize-panel-${kind}`}
          role="tabpanel"
          aria-labelledby={`customize-tab-${kind}`}
          gap={5}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <Text role="status" color="secondary">正在读取资源…</Text>
          ) : error ? (
            <Text role="alert" color="secondary">{error}</Text>
          ) : visible.length === 0 ? (
            <Text role="status" color="secondary">{query ? '没有匹配的资源' : activeTab.empty}</Text>
          ) : scopes.map((scope) => {
            const rows = visible.filter((entry) => entry.scope === scope.id)
            if (!rows.length) return null
            return (
              <VStack key={scope.id} gap={1}>
                <HStack gap={2} vAlign="center">
                  <Heading level={2}>{scope.label}</Heading>
                  <Badge label={rows.length} />
                </HStack>
                <List hasDividers edge="flush" density="balanced">
                  {rows.map((entry) => (
                    <ListItem
                      key={entry.id}
                      label={entry.name}
                      description={entry.description}
                      startContent={<Icon icon={activeTab.icon} size="md" color="secondary" />}
                      endContent={<Icon icon={ChevronRightIcon} size="sm" color="secondary" />}
                      onClick={() => {
                        scrollTop.current = list.current?.scrollTop ?? 0
                        setSelected(entry)
                      }}
                    />
                  ))}
                </List>
              </VStack>
            )
          })}
        </VStack>
      </VStack>
    </VStack>
  )
}
