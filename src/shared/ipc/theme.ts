/**
 * 应用主题 IPC 契约（注册表制）。
 * 主题 id 为开放字符串，内置 'dark'（经典黑，默认）与 'planche'（石板色）；
 * 第三方经 theme registry 注册新 id 后直接可用，无需改动本契约。
 * 解析一律走 registry.getThemeDefinition()（未知 id 回落默认），此处只做形态归一。
 */
export const THEME_CHANNELS = {
  get: 'theme:get',
  update: 'theme:update',
  changed: 'theme:changed',
} as const

export type ThemeChannel = (typeof THEME_CHANNELS)[keyof typeof THEME_CHANNELS]

/** 开放主题 id；内置值见 BUILT_IN_THEME_IDS（历史 'light' 视为未注册，由读取侧回落默认）。 */
export type AppTheme = string

/** 下拉顺序即数组顺序：经典黑第一，石板色第二。 */
export const BUILT_IN_THEME_IDS = ['dark', 'planche'] as const

export const DEFAULT_APP_THEME: AppTheme = 'dark'

export function normalizeAppTheme(value: unknown): AppTheme {
  if (typeof value === 'string' && value.length > 0) return value
  return DEFAULT_APP_THEME
}

export interface ThemeAPI {
  get(): Promise<AppTheme>
  update(theme: AppTheme): Promise<AppTheme>
  onChanged(callback: (theme: AppTheme) => void): () => void
}
