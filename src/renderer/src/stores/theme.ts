import { create } from 'zustand'
import { DEFAULT_APP_THEME, normalizeAppTheme, type AppTheme } from '../../../shared/ipc/theme'
import { useSyncExternalStore } from 'react'
import { getThemeDefinition, subscribeThemeRegistry, themeRegistryRevision } from '../../../shared/theme/registry'
import { useBrowserOcclusionStore } from './browser-occlusion'
import { applyThemeToDocument, getAppTheme } from '@/services/theme'

interface ThemeStore {
  theme: AppTheme
  loaded: boolean
  load: () => Promise<void>
  setTheme: (theme: AppTheme) => Promise<void>
  applyExternal: (theme: AppTheme) => void
}

let loadPromise: Promise<void> | null = null
let unsubscribeChanged: (() => void) | null = null

export const useThemeStore = create<ThemeStore>()((set, get) => ({
  theme: DEFAULT_APP_THEME,
  loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve()
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const theme = normalizeAppTheme(await getAppTheme())
        set({ theme, loaded: true })
        applyThemeToDocument(theme)
      } catch {
        set({ theme: DEFAULT_APP_THEME, loaded: true })
        applyThemeToDocument(DEFAULT_APP_THEME)
      }
      if (!unsubscribeChanged && window.electron?.theme?.onChanged) {
        unsubscribeChanged = window.electron.theme.onChanged((next) => {
          get().applyExternal(next)
        })
      }
    })()
    return loadPromise
  },
  setTheme: async (theme) => {
    const { updateAppTheme } = await import('@/services/theme')
    const next = await updateAppTheme(theme)
    set({ theme: next, loaded: true })
  },
  applyExternal: (theme) => {
    const next = normalizeAppTheme(theme)
    if (next === get().theme) {
      applyThemeToDocument(next)
      return
    }
    set({ theme: next, loaded: true })
    applyThemeToDocument(next)
  },
}))

export function useThemeInit(): void {
  // 供 App 根调用：首屏即加载持久化主题，避免默认闪烁后再切实际主题。
  if (typeof window !== 'undefined') {
    void useThemeStore.getState().load()
  }
}

/** JS 侧令牌读取：返回当前主题的 token→value 表（xterm/Monaco 之外的动态色走这里）。 */
export function useThemeTokens(): Record<string, string> {
  return useThemeDefinition().tokens
}

// Note: .agents/notes/workbench/plugin-contract-v1.md — catalog arrival/revocation can change a theme without changing its saved ID.
export function useThemeDefinition() {
  const theme = useThemeStore(s => s.theme)
  useSyncExternalStore(subscribeThemeRegistry, themeRegistryRevision)
  const covered = useBrowserOcclusionStore(s => s.count > 0)
  const definition = getThemeDefinition(theme)
  return covered && definition.pluginBase ? getThemeDefinition(definition.pluginBase) : definition
}
