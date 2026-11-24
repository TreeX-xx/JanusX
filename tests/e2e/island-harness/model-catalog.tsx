import React from 'react'
import { createRoot } from 'react-dom/client'
import { ModelCatalogPanel } from '../../../src/renderer/src/components/ModelCatalogPanel'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import bundled from '../../../packages/llm-core/src/registry/models.openrouter.generated.json'
import type { ModelCatalogSnapshot } from '@janusx/llm-core'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
await initI18n()
await changeLanguage('zh-CN')
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') ?? 'planche')
document.body.style.background = 'var(--shell-canvas)'
const catalog: ModelCatalogSnapshot = {
  source: 'cache', isStale: false, updatedAt: '2026-10-17T08:00:00Z',
  models: [{
    id: 'example/reasoning-pro', name: 'Reasoning Pro', source: 'openrouter', providerAuthor: 'Example',
    aliases: [], normalizedKeys: [], effectiveContextWindow: 1000000, maxOutputTokens: 64000,
    inputModalities: ['text', 'image'], outputModalities: ['text'],
    supportedParameters: ['tools', 'reasoning', 'structured_outputs', 'temperature'],
    description: 'A sample model for catalog layout and interaction verification.',
    pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002', input_cache_write: '0.0000025', input_cache_write_1h: '0.000004', web_search: '0.01', overrides: [{ min_prompt_tokens: 200000, prompt: '0.000004', completion: '0.000015' }] },
  }, {
    id: 'example/minimal', name: 'Minimal', source: 'openrouter', providerAuthor: 'Example', aliases: [], normalizedKeys: [],
  }],
}
if (new URLSearchParams(location.search).has('bundled')) {
  catalog.models = bundled.models.map(model => ({ ...model, source: 'openrouter' }))
  catalog.source = 'bundled'
  catalog.updatedAt = bundled.updatedAt
}
if (new URLSearchParams(location.search).has('browse')) {
  for (let index = 0; index < 30; index++) {
    catalog.models.push({ ...catalog.models[0], id: `custom/model-${index}`, name: `Model ${index}`, providerAuthor: 'DeepSeek' })
  }
}
window.electron.llm.getModelCatalog = async () => new URLSearchParams(location.search).has('empty')
  ? { ...catalog, models: [] }
  : catalog
window.electron.llm.refreshModelCatalog = async () => ({ success: true, catalog })
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 850, padding: 24, margin: 'auto', color: 'var(--shell-text)', '--so-field': 'var(--shell-card)', '--so-field-border': 'var(--shell-border)', '--so-control-h': '36px', '--so-rule-soft': 'var(--shell-border-soft)', '--so-radius': '8px' } as React.CSSProperties}><ModelCatalogPanel /></main>)
