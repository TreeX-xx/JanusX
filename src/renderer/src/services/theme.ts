import { BUILT_IN_THEME_IDS, DEFAULT_APP_THEME, normalizeAppTheme, type AppTheme } from '../../../shared/ipc/theme'
import { getThemeDefinition, subscribeThemeRegistry } from '../../../shared/theme/registry'
import { useBrowserOcclusionStore } from '@/stores/browser-occlusion'

export type { AppTheme }
export { normalizeAppTheme }
const ownedTokens = new Set<string>()
let selectedTheme: AppTheme = DEFAULT_APP_THEME
useBrowserOcclusionStore.subscribe(() => applyThemeToDocument(selectedTheme))
subscribeThemeRegistry(() => applyThemeToDocument(selectedTheme))

export function applyThemeToDocument(theme: AppTheme): void {
  selectedTheme = theme
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // 显式声明活动主题以命中生成的 palette 和结构皮肤；未知 id 回落默认。
  const resolved = getThemeDefinition(theme)
  const protectedSurface = useBrowserOcclusionStore.getState().count > 0
  root.dataset.theme = resolved.pluginBase ?? resolved.id
  root.dataset.pluginTheme = resolved.pluginBase ? resolved.id : ''
  for (const key of ownedTokens) root.style.removeProperty(`--${key}`)
  ownedTokens.clear()
  // Runtime registrations have no generated CSS block. Apply their complete token set;
  // authorized plugin palettes still expose only their bounded overrides.
  const runtime = !BUILT_IN_THEME_IDS.some(id => id === resolved.id)
  const tokens: Record<string, string> = resolved.overrides ? { ...resolved.overrides }
    : runtime ? { ...resolved.tokens, 'selection-background': resolved.selection } : {}
  if (runtime) {
    tokens['theme-color-scheme'] = resolved.base
    for (const [key, value] of Object.entries(resolved.xterm)) tokens[`terminal-${key}`] = value
  }
  if (!protectedSurface || !resolved.pluginBase) for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value); ownedTokens.add(key)
  }
  root.style.colorScheme = resolved.base
}

export async function getAppTheme(): Promise<AppTheme> {
  const api = window.electron?.theme
  if (!api) return DEFAULT_APP_THEME
  try {
    return normalizeAppTheme(await api.get())
  } catch {
    return DEFAULT_APP_THEME
  }
}

export async function updateAppTheme(theme: AppTheme): Promise<AppTheme> {
  const normalized = normalizeAppTheme(theme)
  const api = window.electron?.theme
  if (!api) {
    applyThemeToDocument(normalized)
    return normalized
  }
  const next = normalizeAppTheme(await api.update(normalized))
  applyThemeToDocument(next)
  return next
}
