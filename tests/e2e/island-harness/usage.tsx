import React from 'react'
import { createRoot } from 'react-dom/client'
import { UsageStatsPanel } from '../../../src/renderer/src/components/UsageStatsPanel'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import type { UsageRecord } from '../../../src/shared/usage'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
await initI18n()
await changeLanguage(new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh-CN')
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') ?? 'planche')
document.body.style.background = 'var(--shell-canvas)'
const now = new Date()
const records: UsageRecord[] = [
  { id: '1', engine: 'codex', sessionId: 'codex', at: now.getTime(), timeBasis: 'sample', totalTokens: 12000, inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 8000, cacheWriteTokens: 1000, model: 'gpt-5.4' },
  { id: '2', engine: 'claude', sessionId: 'claude', at: Math.min(now.getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8).getTime()), timeBasis: 'event', totalTokens: 4000, inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 2000, model: 'claude-sonnet-4-6' },
]
if (new URLSearchParams(location.search).get('mix') === 'all') records.push(
  { id: '3', engine: 'opencode', sessionId: 'opencode', at: now.getTime(), timeBasis: 'sample', totalTokens: 6000, inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 3000, model: 'glm-5.2' },
  { id: '4', engine: 'pi', sessionId: 'pi', at: now.getTime(), timeBasis: 'event', totalTokens: 3000, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 1500, model: 'gemini-3.1-pro' },
)
if (new URLSearchParams(location.search).get('history') === 'yes') {
  const historical = new Date(now)
  historical.setDate(historical.getDate() - 180)
  records.push(
    { id: 'history-codex', engine: 'codex', sessionId: 'history-codex', at: historical.getTime(), timeBasis: 'event', totalTokens: 100000, inputTokens: 90000, outputTokens: 10000 },
    { id: 'history-claude', engine: 'claude', sessionId: 'history-claude', at: historical.getTime(), timeBasis: 'event', totalTokens: 60000, inputTokens: 50000, outputTokens: 10000 },
  )
}
if (new URLSearchParams(location.search).get('detail') === 'yes') records.push(
  { id: 'detail-same', engine: 'codex', sessionId: 'codex', at: now.getTime(), timeBasis: 'event', model: 'gpt-5.4', totalTokens: 1000, inputTokens: 300, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 0 },
  { id: 'detail-switch', engine: 'codex', sessionId: 'codex', at: now.getTime(), timeBasis: 'event', model: 'provider/model-with-a-long-name-and-version-2026-11-03', totalTokens: 2000, inputTokens: 500, outputTokens: 300, cacheReadTokens: 1200, cacheWriteTokens: 0 },
  { id: 'detail-other', engine: 'claude', sessionId: 'claude', at: now.getTime(), timeBasis: 'event', model: 'gpt-5.4', totalTokens: 500, inputTokens: 400, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  { id: 'detail-unknown', engine: 'codex', sessionId: 'codex', at: now.getTime(), timeBasis: 'event', totalTokens: 100, inputTokens: 100, outputTokens: 0 },
)
if (new URLSearchParams(location.search).get('cache') === 'partial') records.push(
  { id: 'partial', engine: 'codex', sessionId: 'codex', at: now.getTime(), timeBasis: 'event', model: 'gpt-5.4', totalTokens: 100, inputTokens: 100, outputTokens: 0 },
)
window.electron.system.listUsageLedger = async query => ({ records: records.filter(record => record.at >= query.start && record.at <= query.end && (!query.engine || record.engine === query.engine)), sessions: [], throughId: 2 })
const priceCatalog = {
  source: 'cache' as const, updatedAt: now.toISOString(), isStale: false,
  models: [{ id: 'openai/gpt-5.4', name: 'GPT 5.4', source: 'openrouter' as const, aliases: ['gpt-5.4'], normalizedKeys: ['gpt54', 'gpt 5 4'], pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002', input_cache_write: '0.0000025' } }],
}
window.electron.llm.getModelCatalog = async () => priceCatalog
window.electron.llm.refreshModelCatalog = async () => ({ success: true, catalog: priceCatalog })
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 800, padding: 24, margin: 'auto' }}><UsageStatsPanel /></main>)
