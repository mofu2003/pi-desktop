import { useEffect, useState } from 'react'
import { ArrowLeftIcon, FolderOpenIcon } from '@heroicons/react/24/outline'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { List, ListItem } from '@astryxdesign/core/List'
import { Markdown } from '@astryxdesign/core/Markdown'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import type { CustomizationDetail, CustomizationResource } from '../../../shared/types'
import { LAYOUT_WIDTHS } from '../lib/layout'

const exposureLabels: Record<string, string> = {
  codemode: '代码模式',
  deferred: '按需发现',
  direct: '直接提供',
  hidden: '隐藏'
}

export function CustomizationDetailScreen({
  resource,
  onBack,
  onReveal,
  actionError
}: {
  resource: CustomizationResource
  onBack: () => void
  onReveal: () => void
  actionError: string
}): React.JSX.Element {
  const [detail, setDetail] = useState<CustomizationDetail>()
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')
  const [filename, setFilename] = useState('')
  const [source, setSource] = useState<{ filename: string; text: string }>()
  const [fileError, setFileError] = useState('')
  const [mode, setMode] = useState('preview')
  const isSkill = resource.kind === 'skills'
  const isMarkdown = filename.toLowerCase().endsWith('.md')
  const mcp = detail?.mcp

  useEffect(() => {
    let cancelled = false
    void window.piDesktop.getCustomizationDetail(resource.id).then((result) => {
      if (cancelled) return
      setDetail(result)
      setFilename(result.files[0] ?? '')
    }).catch(() => {
      if (!cancelled) setError('无法读取资源详情，请返回后刷新列表。')
    })
    return () => { cancelled = true }
  }, [resource.id])

  useEffect(() => {
    if (tab !== 'files' || !filename) return
    let cancelled = false
    setFileError('')
    setSource(undefined)
    void window.piDesktop.readCustomizationFile(resource.id, filename).then((text) => {
      if (!cancelled) setSource({ filename, text })
    }).catch(() => {
      if (!cancelled) setFileError('此文件无法预览，可以在访达中打开。')
    })
    return () => { cancelled = true }
  }, [tab, filename, resource.id])

  return (
    <VStack height="100%" hAlign="center" isScrollable>
      <VStack width="100%" maxWidth={LAYOUT_WIDTHS.customizeColumn} padding={6} gap={5}>
        <HStack hAlign="start">
          <Button
            label="返回资源列表"
            variant="ghost"
            size="sm"
            icon={<Icon icon={ArrowLeftIcon} size="sm" />}
            onClick={onBack}
          />
        </HStack>
        <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
          <VStack gap={1}>
            <Heading level={1} weight="semibold">{resource.name}</Heading>
            <Text type="supporting" color="secondary">
              {resource.scope === 'project' ? '当前项目' : '个人资源'}
            </Text>
          </VStack>
          <Button
            label="在访达中显示"
            variant="secondary"
            size="sm"
            icon={<Icon icon={FolderOpenIcon} size="sm" />}
            onClick={onReveal}
          />
        </HStack>
        {actionError && <Text role="alert" color="secondary">{actionError}</Text>}

        {isSkill && (
          <TabList
            role="tablist"
            aria-label="技能详情"
            value={tab}
            onChange={setTab}
            hasDivider
          >
            <Tab value="overview" id="skill-overview-tab" label="概览" panelId="skill-overview" />
            <Tab
              value="files"
              id="skill-files-tab"
              label="内容"
              panelId="skill-files"
              endContent={detail?.files.length ? <Badge label={detail.files.length} /> : undefined}
            />
          </TabList>
        )}

        {tab === 'overview' && (
          <VStack
            id={isSkill ? 'skill-overview' : undefined}
            role={isSkill ? 'tabpanel' : undefined}
            aria-labelledby={isSkill ? 'skill-overview-tab' : undefined}
            gap={4}
          >
            {isSkill ? (
              <VStack gap={2}>
                <Heading level={2}>说明</Heading>
                <Text>{resource.description || '此技能暂无说明。'}</Text>
                <Text type="supporting" color="secondary">Pi 会话命令</Text>
                <Text type="code">/skill:{resource.name}</Text>
              </VStack>
            ) : (
              <VStack gap={3}>
                <Heading level={2}>{resource.kind === 'mcp' ? '连接器配置' : '扩展概要'}</Heading>
                <Text>{resource.description}</Text>
                {mcp?.description && <Text color="secondary">{mcp.description}</Text>}
                {mcp && (
                  <HStack gap={4} wrap="wrap">
                    <Text>配置状态 · {mcp.enabled === undefined ? '继承' : mcp.enabled ? '已启用' : '已停用'}</Text>
                    <Text>默认暴露 · {mcp.exposure ? exposureLabels[mcp.exposure] : '继承'}</Text>
                  </HStack>
                )}
              </VStack>
            )}
            {mcp && (
              <VStack gap={2}>
                <Heading level={2}>工具暴露规则</Heading>
                {mcp.rules.length ? (
                  <List hasDividers edge="flush">
                    {mcp.rules.map(({ pattern, exposure }) => (
                      <ListItem key={pattern} label={pattern} endContent={<Text>{exposureLabels[exposure]}</Text>} />
                    ))}
                  </List>
                ) : <Text color="secondary">此连接器没有单独配置的工具规则。</Text>}
              </VStack>
            )}
            {error && <Text role="alert" color="secondary">{error}</Text>}
          </VStack>
        )}

        {isSkill && tab === 'files' && (
          <VStack id="skill-files" role="tabpanel" aria-labelledby="skill-files-tab" gap={3}>
            {error ? <Text role="alert" color="secondary">{error}</Text> : !detail ? (
              <Text role="status" color="secondary">正在读取文件列表…</Text>
            ) : (
              <>
                <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
                  <DropdownMenu
                    button={{ label: filename || '选择文件', size: 'sm', variant: 'secondary' }}
                    items={detail.files.map((file) => ({
                      id: file, label: file, onClick: () => setFilename(file)
                    }))}
                  />
                  {isMarkdown && (
                    <SegmentedControl label="文件显示方式" value={mode} onChange={setMode} size="sm">
                      <SegmentedControlItem value="preview" label="预览" />
                      <SegmentedControlItem value="source" label="源码" />
                    </SegmentedControl>
                  )}
                </HStack>
                {fileError ? <Text role="alert" color="secondary">{fileError}</Text>
                  : source?.filename !== filename ? <Text role="status" color="secondary">正在读取文件…</Text>
                  : isMarkdown && mode === 'preview' ? (
                    <Markdown
                      contentWidth="100%"
                      headingLevelStart={2}
                      onLinkClick={() => false}
                      components={{ image: ({ alt }) => alt ? <Text color="secondary">{alt}</Text> : null }}
                    >
                      {source.text.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')}
                    </Markdown>
                  ) : (
                    <CodeBlock
                      code={source.text}
                      width="100%"
                      language={isMarkdown ? 'markdown' : filename.split('.').at(-1)}
                      title={filename}
                    />
                  )}
              </>
            )}
          </VStack>
        )}
      </VStack>
    </VStack>
  )
}
