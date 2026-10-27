import { createRoot } from 'react-dom/client'
import { connect } from './client'
import { App } from './App'
import { setLocale, t } from './i18n'
import './style.css'

const root = createRoot(document.getElementById('app')!)
setLocale(navigator.language)
void connect().then(async api => {
  const [initialContext, info] = await Promise.all([api.workspace.getContext(), api.app.getInfo()])
  let context = initialContext, transitioning = false
  const render = () => root.render(<App context={context} transitioning={transitioning} />)
  const theme = (value: { id: string; tokens: Record<string, string> }) => {
    document.documentElement.dataset.theme = value.id
    for (const [key, token] of Object.entries(value.tokens)) if (/^--[a-z0-9-]+$/i.test(key)) document.documentElement.style.setProperty(key, token)
  }
  theme(info.theme)
  setLocale(info.locale)
  await api.context.subscribe(event => {
    if (event.theme) theme(event.theme)
    if (event.locale) setLocale(event.locale)
    if (event.workspace) context = event.workspace
    if (event.transitioning !== undefined) transitioning = event.transitioning
    render()
  })
  render()
}).catch(() => root.render(<main className="empty"><h1>{t('蓝图未连接')}</h1><p>{t('请在设置 → 插件中启用蓝图并授权当前项目，然后重新打开。')}</p></main>))
