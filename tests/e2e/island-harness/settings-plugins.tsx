// Real plugin React views behind the public SDK's MessagePort transport. No native services run.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { connectPlugin } from '@janusx/plugin-sdk'
import { SettingsSurface } from '@janusx/ui'
import { getThemeDefinition } from '../../../src/shared/theme/registry'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../../plugins/blueprint/src/shared/blueprint-review-settings'
import { normalizeCpaSettings } from '../../../plugins/cpa/src/shared/cpa'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

const params = new URLSearchParams(location.search)
const kind = params.get('plugin') ?? 'blueprint'
const theme = getThemeDefinition(params.get('theme'))
document.documentElement.dataset.theme = theme.id
for (const [key, value] of Object.entries(theme.tokens)) document.documentElement.style.setProperty(`--${key}`, value)
document.body.style.cssText = 'margin:0;background:var(--shell-canvas);color:var(--shell-text);font-family:system-ui'

if (!params.has('frame')) {
  const frame = document.createElement('iframe')
  frame.title = 'Plugin settings'
  frame.style.cssText = 'display:block;width:100%;height:100vh;border:0'
  let settings = structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), revision = 0
  let cpa = normalizeCpaSettings({ mode: 'managed', enabled: false, port: 8317, autoUpdate: true })
  let mcpImported = false
  const stored = new Map<string, { revision: number; value: unknown }>()
  const calls: Array<{ method: string; input?: unknown }> = []
  Object.assign(window, { settingsCalls: calls })
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.data !== 'fixture-ready') return
    const channel = new MessageChannel()
    channel.port1.onmessage = async event => {
      const request = event.data
      if (request.type !== 'request') return
      const native = request.method === 'native.call'
      const method = native ? request.params.method : request.method
      const input = native ? request.params.input : request.params
      calls.push({ method, input })
      let result: unknown = null
      if (method === 'app.getInfo') result = { locale: 'en', theme: { id: theme.id, tokens: theme.tokens } }
      else if (method === 'storage.get') result = stored.get(input.key) ?? { revision: 0, value: null }
      else if (method === 'storage.set') { result = { revision: (stored.get(input.key)?.revision ?? 0) + 1, value: input.value }; stored.set(input.key, result as { revision: number; value: unknown }) }
      else if (method === 'models.catalog') result = [{ id: 'local', name: 'Local provider', models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }] }]
      else if (method === 'settings.snapshot') result = { value: settings, revision: revision.toString(16).padStart(64, '0') }
      else if (method === 'settings.update') { settings = input.value; revision++ }
      else if (method === 'settings.credential-status' || method === 'settings.credential-set') result = { configured: false }
      else if (method === 'settings.check') result = { generation: { status: 'ready' }, jev: { status: 'disabled' } }
      else if (method === 'migration.status') result = { steps: {} }
      else if (method === 'mcp.status') result = { available: true, clients: [{ id: 'codex', label: 'Codex', path: 'config.toml', hash: 'fixture', state: mcpImported ? 'current' : 'absent' }] }
      else if (method === 'mcp.change') { await new Promise(resolve => setTimeout(resolve, 250)); mcpImported = input.action === 'import' }
      else if (method === 'mcp.probe') result = { ok: true, tools: [] }
      else if (method === 'legacy.list') result = [{ id: 'legacy', name: 'Legacy blueprint', nodes: 1 }]
      else if (method === 'legacy.preview') result = { token: 'preview-1', notes: [{ uri: 'note://fixture', title: 'Imported note', kind: 'decision' }], warnings: [], documents: [] }
      else if (method === 'legacy.apply') result = { ok: true }
      else if (method === 'settings.read') result = cpa
      else if (method === 'settings.save') cpa = input.settings
      else if (method === 'runtime.status') result = { phase: 'stopped', busy: false, revision: 0 }
      channel.port1.postMessage({ protocol: 1, type: 'response', requestId: request.requestId, ok: true, result: kind === 'cpa' && native ? { ok: true, data: result } : result, contextRevision: 0 })
    }
    frame.contentWindow!.postMessage({ type: 'janusx:plugin-port', contextRevision: 0 }, location.origin, [channel.port2])
  })
  frame.src = location.pathname + location.search + '&frame=1'
  document.getElementById('root')!.append(frame)
} else {
  let content: React.ReactNode
  if (kind === 'blueprint') {
    const [{ connect }, { Settings }, { LegacyImport }, { setLocale }] = await Promise.all([
      import('../../../plugins/blueprint/src/ui/client'), import('../../../plugins/blueprint/src/ui/Settings'),
      import('../../../plugins/blueprint/src/ui/LegacyImport'), import('../../../plugins/blueprint/src/ui/i18n'),
    ])
    const connection = connect()
    window.parent.postMessage('fixture-ready', location.origin)
    await connection; setLocale('en')
    content = <><Settings models={[]} saved={() => undefined} /><LegacyImport changed={() => { document.body.dataset.imported = 'true' }} /></>
  } else {
    const [{ setApi }, { CpaSettingsPanel }, { setLocale }] = await Promise.all([
      import('../../../plugins/cpa/src/ui/bridge'), import('../../../plugins/cpa/src/ui/CpaSettingsPanel'), import('../../../plugins/cpa/src/ui/i18n'),
    ])
    const connection = connectPlugin()
    window.parent.postMessage('fixture-ready', location.origin)
    setApi(await connection); setLocale('en')
    content = <CpaSettingsPanel />
  }
  createRoot(document.getElementById('root')!).render(<SettingsSurface style={{ padding: 24, minHeight: '100vh', boxSizing: 'border-box' }}>{content}</SettingsSurface>)
}
