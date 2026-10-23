import { create } from 'zustand'
import {
  createShellProfileSeed,
  DEFAULT_HIDDEN_CLI_PRESETS,
  normalizeShellProfiles,
  type ShellCandidate,
  type ShellProfilesSettings,
} from '../../../shared/shellProfiles'

interface ShellProfilesStore {
  settings: ShellProfilesSettings
  loaded: boolean
  load: () => Promise<void>
  save: (settings: ShellProfilesSettings) => Promise<void>
  detect: () => Promise<ShellCandidate[]>
}

let loadPromise: Promise<void> | null = null

function fallbackSettings(): ShellProfilesSettings {
  const platform = window.electron?.platform ?? 'win32'
  return normalizeShellProfiles({ entries: [createShellProfileSeed(platform)], hiddenCliPresets: [...DEFAULT_HIDDEN_CLI_PRESETS] })
}

/**
 * 设置「终端管理」的单一数据源：三处新建入口与设置面板都读这里。
 * 未加载时先给平台种子，避免入口在首帧拿到空列表。
 */
export const useShellProfilesStore = create<ShellProfilesStore>()((set, get) => ({
  settings: fallbackSettings(),
  loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve()
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const settings = normalizeShellProfiles(await window.electron.shellProfiles.list())
        set({ settings, loaded: true })
      } catch {
        set({ settings: fallbackSettings(), loaded: true })
      }
    })()
    return loadPromise
  },
  save: async (settings) => {
    // 先本地生效；IPC 失败时回滚到已知状态，设置面板不会停在虚假的已保存态。
    const previous = get().settings
    const normalized = normalizeShellProfiles(settings)
    set({ settings: normalized, loaded: true })
    try {
      const saved = normalizeShellProfiles(await window.electron.shellProfiles.save(normalized))
      set({ settings: saved })
    } catch (err) {
      set({ settings: previous })
      throw err
    }
  },
  detect: () => window.electron.shellProfiles.detect(),
}))

/** 供启动链路使用：确保已加载后返回设置（首帧种子已在 store 里，不阻塞调用方）。 */
export async function loadShellProfiles(): Promise<ShellProfilesSettings> {
  await useShellProfilesStore.getState().load()
  return useShellProfilesStore.getState().settings
}
