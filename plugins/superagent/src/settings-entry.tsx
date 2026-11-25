import { createRoot } from 'react-dom/client'
import { connectPlugin } from '@janusx/plugin-sdk'
import { WorkerSettings, type SettingsCall } from './WorkerSettings'
import '@janusx/plugin-sdk/theme.css'
import './settings.css'

async function start() {
  const api = await connectPlugin()
  const info = await api.app.getInfo()
  const root = createRoot(document.querySelector('main')!)
  const call: SettingsCall = (method, input = {}) => api.native.call({ method, input })
  const setLocale = (locale: string) => {
    document.documentElement.lang = locale
    root.render(<WorkerSettings call={call} zh={locale.startsWith('zh')} />)
  }
  const setTheme = (theme: typeof info.theme) => {
    document.documentElement.dataset.theme = theme.id
    for (const [key, token] of Object.entries(theme.tokens)) {
      if (/^--[a-z0-9-]+$/i.test(key)) document.documentElement.style.setProperty(key, token)
    }
  }
  setTheme(info.theme)
  setLocale(info.locale)
  await api.context.subscribe(event => {
    if (event.theme) setTheme(event.theme)
    if (event.locale) setLocale(event.locale)
  })
}
void start().catch(error => { document.querySelector('main')!.textContent = String(error) })
