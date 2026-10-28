import { DEFAULT_APP_THEME, normalizeAppTheme, type AppTheme } from '../../../shared/ipc/theme'
import { getThemeDefinition } from '../../../shared/theme/registry'
import { useBrowserOcclusionStore } from '@/stores/browser-occlusion'

export type { AppTheme }
export { normalizeAppTheme }
const ownedTokens = new Set<string>()
let selectedTheme: AppTheme = DEFAULT_APP_THEME
useBrowserOcclusionStore.subscribe(() => applyThemeToDocument(selectedTheme))

export function applyThemeToDocument(theme: AppTheme): void {
  selectedTheme = theme
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // data-theme 始终挂载：经典黑（默认）与石板色都显式声明，手写皮肤
  //（[data-theme='planche'] / [data-theme='dark']）在两种模式下都命中；
  // 未知 id 经 getThemeDefinition 回落默认，永不白屏。
  const resolved = getThemeDefinition(theme)
  const protectedSurface = useBrowserOcclusionStore.getState().count > 0
  root.dataset.theme = resolved.pluginBase ?? resolved.id
  root.dataset.pluginTheme = resolved.pluginBase ? resolved.id : ''
  for (const key of ownedTokens) root.style.removeProperty(`--${key}`)
  ownedTokens.clear()
  if (!protectedSurface) for (const [key, value] of Object.entries(resolved.overrides ?? {})) {
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
