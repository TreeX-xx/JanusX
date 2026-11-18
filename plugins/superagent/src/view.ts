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
      if (document.body.dataset.view === 'settings') {
        const policy = await call('settings.read') as { defaultBackend: string; enabled: string[] }
        if (generation !== revision) return
        const form = document.createElement('form')
        const field = el('fieldset', ''), legend = el('legend', text('Enabled Workers', '已启用的 Worker'))
        field.append(legend)
        for (const backend of ['codex', 'claude']) {
          const label = el('label', ''), check = document.createElement('input')
          check.type = 'checkbox'; check.name = 'engines'; check.value = backend; check.checked = policy.enabled.includes(backend)
          label.append(check, backend === 'codex' ? 'Codex' : 'Claude'); field.append(label)
        }
        const label = el('label', text('Default Worker', '默认 Worker')), select = document.createElement('select')
        for (const backend of ['codex', 'claude']) select.add(new Option(backend === 'codex' ? 'Codex' : 'Claude', backend))
        select.value = policy.defaultBackend; label.append(select)
        const save = el('button', text('Save', '保存'))
        form.append(field, label, save)
        save.type = 'button'
        form.onsubmit = event => event.preventDefault()
        save.onclick = async () => {
          const enabled = new FormData(form).getAll('engines').map(String)
          if (!enabled.includes(select.value)) { status.textContent = text('Enable the default Worker before saving.', '请先启用默认 Worker。'); return }
          save.disabled = true
          try { await call('settings.save', { enabled, defaultBackend: select.value }); status.textContent = text('Saved', '已保存') }
          catch (error) { status.textContent = String(error) }
          finally { save.disabled = false }
        }
        root.replaceChildren(form)
      } else {
        const rows = await call('workers.list') as { title: string; phase: string; backend: string | null; queuePosition: number | null }[]
        if (generation !== revision) return
        const list = el('ul', '')
        for (const row of rows) {
          const item = el('li', ''), title = el('strong', row.title)
          item.append(title, el('span', [row.backend, row.phase, row.queuePosition && '#' + row.queuePosition].filter(Boolean).join(' · ')))
          list.append(item)
        }
        root.replaceChildren(rows.length ? list : el('p', text('No work in this project.', '此项目暂无工作。')))
      }
      status.textContent = ''
    } catch (error) { if (generation === revision) status.textContent = String(error) }
  }
  theme(info.theme)
  await api.context.subscribe(event => {
    if (event.theme) theme(event.theme)
    const nextZh = event.locale ? event.locale.startsWith('zh') : zh
    const localeChanged = nextZh !== zh
    zh = nextZh
    if (event.active !== undefined) active = event.active
    if (localeChanged || document.body.dataset.view === 'workers') void render()
  })
  await render()
  if (document.body.dataset.view === 'workers') window.setInterval(() => { if (active && !document.hidden) void render() }, 3000)
}
void start().catch(error => { document.querySelector('[role=status]')!.textContent = String(error) })
