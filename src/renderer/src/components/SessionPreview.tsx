import { useEffect, useState } from 'react'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Markdown } from '@astryxdesign/core/Markdown'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { LAYOUT_WIDTHS } from '../lib/layout'

export function SessionPreview(): React.JSX.Element {
  const [preview, setPreview] = useState<{ title: string; markdown: string }>()
  const [error, setError] = useState(false)
  useEffect(() => {
    void window.piDesktop.getSessionPreview().then((snapshot) => {
      if (snapshot) setPreview(snapshot)
      else setError(true)
    }, () => setError(true))
  }, [])

  return (
    <Layout height="fill" contentWidth="100%" content={
      <LayoutContent padding={4} isScrollable label="会话预览">
        <VStack maxWidth={LAYOUT_WIDTHS.chatColumn} gap={3} paddingBlockStart={8} style={{ marginInline: 'auto' }}>
          {preview ? (
            <>
              <Text as="h1" type="display-3">{preview.title}</Text>
              <Markdown contentWidth="100%">{preview.markdown}</Markdown>
            </>
          ) : <Text role="status">{error ? '无法打开会话预览。' : '正在读取会话…'}</Text>}
        </VStack>
      </LayoutContent>
    } />
  )
}
