import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import './styles.css'

import { createRoot } from 'react-dom/client'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import zhCN from '@astryxdesign/core/locales/zh-CN.generated.js'
import { Theme } from '@astryxdesign/core/theme'
import App from './App'
import '../../astryx-themes'
import { piTheme } from './pi-theme'

const root = createRoot(document.getElementById('root')!)

root.render(
  <InternationalizationProvider locale="zh-CN" messages={{ 'zh-CN': zhCN }}>
    <Theme theme={piTheme} mode="system">
      <App />
    </Theme>
  </InternationalizationProvider>
)
