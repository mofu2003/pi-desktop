import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

export const piTheme = defineTheme({
  name: 'pi-desktop',
  extends: neutralTheme,
  tokens: {
    '--color-background-body': ['#f7f7f4', '#1b1b1b']
  },
  components: {
    'app-shell': {
      'variant:surface': { backgroundColor: 'transparent' }
    },
    'app-shell-header': {
      'variant:surface': {
        backgroundColor: 'transparent',
        borderBlockEnd: 'none'
      }
    },
    'side-nav': {
      base: {
        backgroundColor: 'transparent',
        borderInlineEnd: 'none'
      }
    }
  }
})
