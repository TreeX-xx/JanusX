import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppSettingsModal, type SettingsTab } from '../../../src/renderer/src/components/AppSettingsModal'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { normalizeAppTheme } from '../../../src/shared/ipc/theme'
import { DEFAULT_AGENT_NOTIFICATION_SETTINGS, normalizeAgentNotificationSettings } from '../../../src/shared/notifications'
import type { AgentNotificationSettingsView } from '../../../src/shared/notifications'
import type { UpdaterEvent, UpdaterState } from '../../../src/shared/ipc/updater'
import { LLM_CONSUMERS, authTypeForProtocol, type AgentModelBinding, type LlmConfiguration, type LlmConsumer } from '../../../src/shared/llm-configuration'
import type { NativeLoginState } from '../../../src/shared/native-login'
import { installPluginSettingsFixture } from './plugin-settings-fixture'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const params = new URLSearchParams(location.search)
if (params.has('plugin-market')) installPluginSettingsFixture()
const language = params.has('en') ? 'en' : 'zh-CN'
if (params.get('tab') === 'llm') {
  const config: LlmConfiguration = {
    version: '3.0.0',
    providers: params.has('empty') ? {} : {
      relay: { id: 'relay', name: 'CPA Work', authType: authTypeForProtocol('openai'), baseURL: 'http://127.0.0.1:8317/v1', apiKey: 'fixture-key', modelId: 'gpt-4.1', models: ['gpt-4.1', 'gpt-4o'] },
      official: { id: 'official', name: 'OpenAI Official', authType: authTypeForProtocol('responses'), baseURL: 'https://api.openai.com/v1', apiKey: 'fixture-key', modelId: 'gpt-4.1', models: ['gpt-4.1'], extra: { protocol: 'responses', presetId: 'openai' } },
    },
    bindings: { janus: { mode: 'unconfigured' }, claude: { mode: 'native' }, codex: { mode: 'native' }, opencode: { mode: 'native' }, pi: { mode: 'native' } },
  }
  Object.assign(window.electron.llm, {
    getConfiguration: async () => structuredClone(config),
    getRuntimeStatus: async () => ({ profileSync: { state: 'not-applicable', importedProviderCount: 0 }, connection: { state: 'unconfigured' } }),
    saveProvider: async (provider: typeof config.providers[string]) => {
      if (params.has('saveFail')) return { success: false, error: 'Fixture channel save failed' }
      config.providers[provider.id] = structuredClone(provider)
      for (const consumer of LLM_CONSUMERS) if (consumer !== 'janus' && config.bindings[consumer].providerId === provider.id) config.bindings[consumer].needsApply = true
      return { success: true }
    },
    testConnection: async () => ({ success: true, latency: 42 }),
    discoverModels: async () => ['gpt-4.1', 'gpt-4o'],
    applyBinding: async (consumer: LlmConsumer, binding: AgentModelBinding) => {
      if (params.has('applyFail')) return { success: false, error: 'Fixture connection write failed' }
      config.bindings[consumer] = { ...binding, needsApply: false }
      return { success: true }
    },
    removeTerminalProvider: async (_consumer: LlmConsumer, id: string) => {
      if (LLM_CONSUMERS.some(consumer => config.bindings[consumer].providerId === id)) return { success: false, error: 'Channel in use' }
      delete config.providers[id]
      return { success: true }
    },
  })
  // Native login probe fixture: `&login=logged-in|logged-out|unknown|flip`.
  // Default is unknown so existing native-apply scenarios stay unblocked.
  let loginCalls = 0
  Object.assign(window.electron.llm, {
    getNativeLoginStatus: async (consumer: LlmConsumer): Promise<NativeLoginState> => {
      // Mirrors the main-process probe: pi has no known credential location.
      if (consumer === 'pi') return { status: 'unknown', checkedAt: new Date().toISOString() }
      loginCalls += 1
      const mode = params.get('login') || 'unknown'
      const status = mode === 'flip' ? (loginCalls === 1 ? 'logged-out' : 'logged-in')
        : mode === 'logged-in' || mode === 'logged-out' ? mode
        : 'unknown'
      return { status, checkedAt: new Date().toISOString() }
    },
  })
  if (params.has('login')) {
    Object.assign(window.electron.llm, {
      startNativeLogin: async (consumer: LlmConsumer) => {
        document.documentElement.dataset.nativeLoginStart = consumer
        return { success: true }
      },
      stopNativeLogin: async () => undefined,
    })
  }
}
if (params.has('updater')) {
  let autoCheck = true
  let listener: ((event: UpdaterEvent) => void) | undefined
  let state: UpdaterState = {
    phase: 'idle', supported: true, unsupportedReason: null, currentVersion: '1.0.0',
    availableVersion: null, downloadPercent: null, releaseNotes: null, error: null,
  }
  Object.assign(window.electron.updater, {
    getState: async () => state,
    getSettings: async () => ({ autoCheck }),
    updateSettings: async (next: { autoCheck: boolean }) => { autoCheck = next.autoCheck; return { autoCheck } },
    onEvent: (callback: (event: UpdaterEvent) => void) => { listener = callback; return () => { listener = undefined } },
    check: async () => {
      state = { ...state, phase: 'downloaded', availableVersion: '1.1.0', releaseNotes: 'A more focused workspace.' }
      listener?.({ type: 'downloaded', version: '1.1.0' })
      return state
    },
    install: async () => { document.documentElement.dataset.updateInstalled = 'true'; return { ok: true } },
    openRepository: async () => {
      if (params.has('linkFail')) throw new Error('Browser unavailable')
      document.documentElement.dataset.repositoryOpened = 'true'
    },
  })
}
let theme = normalizeAppTheme(params.get('theme'))
Object.assign(window.electron.system, { getLanguage: async () => language, setLanguage: async () => undefined })
Object.assign(window.electron.theme, { get: async () => theme, update: async (id: string) => { theme = normalizeAppTheme(id); return theme } })
let settings = structuredClone(DEFAULT_AGENT_NOTIFICATION_SETTINGS)
const toView = (): AgentNotificationSettingsView => {
  const { appSecret, ...feishu } = settings.remote.providers.feishu
  return { ...settings, remote: { ...settings.remote, providers: { feishu: { ...feishu, appSecretConfigured: Boolean(appSecret) } } } }
}
Object.assign(window.electron.notificationSettings, {
  get: async () => toView(),
  update: async (next: typeof settings) => {
    if (params.has('fail')) throw new Error('Fixture save failed')
    settings = normalizeAgentNotificationSettings(next)
    return toView()
  },
  getFeishuControlStatus: async () => ({ state: 'disabled', enabled: false, configured: false, updatedAt: 0 }),
  testFeishu: async () => ({ providerId: 'feishu', ok: true }),
})
await initI18n()
await changeLanguage(language)
await useThemeStore.getState().load()
const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <AppSettingsModal isOpen initialTab={(params.get('tab') ?? 'general') as SettingsTab} onClose={() => root.unmount()} />,
)
