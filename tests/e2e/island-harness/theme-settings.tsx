import React from 'react'
import ReactDOM from 'react-dom/client'
import { GeneralSettingsPanel } from '../../../src/renderer/src/components/GeneralSettingsPanel'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { DEFAULT_APP_THEME } from '../../../src/shared/ipc/theme'
import { defineTheme, getThemeDefinition } from '../../../src/shared/theme/registry'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const params = new URLSearchParams(location.search)
let saved = params.get('theme') ?? DEFAULT_APP_THEME
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
Object.assign(window.electron.theme, {
  get: async () => saved,
  update: async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (params.has('fail')) throw new Error('Fixture save failure')
    saved = id
    return saved
  },
})
if (params.has('custom')) defineTheme({ ...getThemeDefinition('dark'), id: 'custom', label: 'Custom theme' })
await initI18n()
await changeLanguage('en')
ReactDOM.createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}><GeneralSettingsPanel /></main>,
)
