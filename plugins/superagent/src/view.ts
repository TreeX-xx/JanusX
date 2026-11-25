import './view.css'
import { connectPlugin, type JsonValue } from '@janusx/plugin-sdk'

async function start() {
  const api = await connectPlugin()
  const info = await api.app.getInfo()
  let zh = info.locale.startsWith('zh'), active = true, revision = 0
  const text = (en: string, cn: string) => zh ? cn : en
  const theme = (value: typeof info.theme) => {
    for (const [key, token] of Object.entries(value.tokens)) if (/^--[a-z0-9-]+$/i.test(key)) document.documentElement.style.setProperty(key, token)
  }
  const call = (method: string, input: JsonValue = {}) => api.native.call({ method, input })
  const root = document.querySelector('main')!
  const status = document.querySelector('[role=status]')!
  const el = <T extends keyof HTMLElementTagNameMap>(tag: T, content: string) => {
    const node = document.createElement(tag); node.textContent = content; return node
  }
  async function render() {
    const generation = ++revision
    if (!active) return
    try {
      const rows = await call('workers.list') as { title: string; phase: string; backend: string | null; queuePosition: number | null }[]
      if (generation !== revision) return
      const list = el('ul', '')
      for (const row of rows) {
        const item = el('li', ''), title = el('strong', row.title)
        item.append(title, el('span', [row.backend, row.phase, row.queuePosition && '#' + row.queuePosition].filter(Boolean).join(' · ')))
        list.append(item)
      }
      root.replaceChildren(rows.length ? list : el('p', text('No work in this project.', '此项目暂无工作。')))
      status.textContent = ''
    } catch (error) { if (generation === revision) status.textContent = String(error) }
  }
  theme(info.theme)
  await api.context.subscribe(event => {
    if (event.theme) theme(event.theme)
    if (event.locale) zh = event.locale.startsWith('zh')
    if (event.active !== undefined) active = event.active
    void render()
  })
  await render()
  window.setInterval(() => { if (active && !document.hidden) void render() }, 3000)
}
void start().catch(error => { document.querySelector('[role=status]')!.textContent = String(error) })
