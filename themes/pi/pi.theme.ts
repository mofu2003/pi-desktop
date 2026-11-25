// The pi theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in pi.settings.json and the generated pi.settings.ts;
// change them with `astryx experimental theme editor set pi ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {piSettings} from './pi.settings';

export const piTheme = defineTheme({
  extends: piSettings,
  name: 'pi',
  tokens: {
    '--color-background-body': ['#f7f7f4', '#1b1b1b'],
    '--color-background-popover': ['rgba(255, 255, 255, 0.88)', 'rgba(38, 38, 40, 0.88)'],
  },
  localTokens: {
    // Astryx 0.7 has no selection token: ::selection and the selected
    // sidebar row both read this one.
    '--color-background-selected': ['#dcdcd8', '#3a3a3a'],
  },
  components: {
    'app-shell': {
      'variant:surface': {backgroundColor: 'transparent'},
    },
    'app-shell-header': {
      'variant:surface': {
        backgroundColor: 'transparent',
        borderBlockEnd: 'none',
      },
    },
    'side-nav': {
      base: {
        backgroundColor: 'transparent',
        borderInlineEnd: 'none',
      },
    },
    'side-nav-item': {
      selected: {
        backgroundColor: 'var(--color-background-selected)',
      },
    },
    popover: {
      base: {
        backdropFilter: 'blur(24px) saturate(170%)',
        WebkitBackdropFilter: 'blur(24px) saturate(170%)',
      },
    },
    'dropdown-menu': {
      base: {
        backdropFilter: 'blur(24px) saturate(170%)',
        WebkitBackdropFilter: 'blur(24px) saturate(170%)',
      },
    },
    'context-menu': {
      base: {
        backdropFilter: 'blur(24px) saturate(170%)',
        WebkitBackdropFilter: 'blur(24px) saturate(170%)',
      },
    },
    'trigger-menu': {
      base: {
        minWidth: '24rem',
        maxWidth: 'min(30rem, calc(100vw - 3rem))',
        maxHeight: '20rem',
        padding: 'var(--spacing-1-5)',
        backdropFilter: 'blur(24px) saturate(170%)',
        WebkitBackdropFilter: 'blur(24px) saturate(170%)',
      },
    },
  },
});
