import { createRoot } from 'react-dom/client'
import { connectPlugin } from '@janusx/plugin-sdk'
import { setApi } from './bridge'
import { setLocale } from './i18n'
import { App } from './App'
import './style.css'

async function main() {
  const api = await connectPlugin()
  setApi(api)
  const info = await api.app.getInfo()
  const theme = (value: typeof info.theme) => {
    for (const [key, token] of Object.entries(value.tokens)) if (/^--[a-z0-9-]+$/i.test(key)) document.documentElement.style.setProperty(key, token)
  }
  theme(info.theme); setLocale(info.locale)
  await api.context.subscribe(event => { if(event.theme) theme(event.theme); if(event.locale) setLocale(event.locale) })
  createRoot(document.getElementById('root')!).render(<App settingsPage={location.pathname.endsWith('/settings.html')}/>)
}
void main().catch(error => { document.getElementById('root')!.textContent = error.message })
