import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import './styles.css'

import { createRoot } from 'react-dom/client'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import zhCN from '@astryxdesign/core/locales/zh-CN.generated.js'
import { Theme } from '@astryxdesign/core/theme'
import { defaultThemeSlug, themes } from '../../astryx-themes'
import App from './App'
import { SessionPreview } from './components/SessionPreview'

const root = createRoot(document.getElementById('root')!)
const isSessionPreview = new URLSearchParams(location.search).get('preview') === 'session'

root.render(
  <InternationalizationProvider locale="zh-CN" messages={{ 'zh-CN': zhCN }}>
    <Theme theme={themes[defaultThemeSlug]} mode="system">
      {isSessionPreview ? <SessionPreview /> : <App />}
    </Theme>
  </InternationalizationProvider>
)
