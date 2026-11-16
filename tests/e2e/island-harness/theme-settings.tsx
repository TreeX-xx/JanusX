import React from 'react'
import ReactDOM from 'react-dom/client'
import { GeneralSettingsPanel } from '../../../src/renderer/src/components/GeneralSettingsPanel'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { DEFAULT_APP_THEME } from '../../../src/shared/ipc/theme'
import { defineTheme, getThemeDefinition } from '../../../src/shared/theme/registry'
import { MarkdownContent } from '../../../src/renderer/src/components/chat/ChatContent'
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
const emphasisSample = 'A response with **important details**, *emphasis*, `important_field`, [**a link**](https://example.com) and [`linked_field`](https://example.com).\n\n- **`bold_field`**\n\n> **Quoted emphasis** and `quoted_field`.\n\n| **Column** | Value |\n| --- | --- |\n| **Row** | `table_field` |\n\n```ts\nconst block_field = true\n```\n\n```\nplain_block\n```'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}><GeneralSettingsPanel view={params.has('general') ? 'general' : 'appearance'} />
    {params.has('emphasis') && <><section aria-label="Conversation output"><MarkdownContent variant="conversation" content={emphasisSample} /></section>
      <section aria-label="Chat output"><MarkdownContent content={emphasisSample} /></section></>}
  </main>,
)
