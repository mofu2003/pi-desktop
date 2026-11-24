import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

export const piTheme = defineTheme({
  name: 'pi-desktop',
  extends: neutralTheme,
  tokens: {
    '--color-background-body': ['#f7f7f4', '#1b1b1b']
  },
  components: {
    'side-nav': {
      base: {
        backgroundColor: 'var(--color-background-body)',
        borderInlineEnd: '1px solid var(--color-border)'
      }
    }
  }
})
