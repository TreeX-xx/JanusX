// Note: renderer copy pipeline with gated keys — see .agents/notes/desktop/i18n-pipeline.md
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN'
export const FALLBACK_LANGUAGE: SupportedLanguage = 'zh-CN'

export const DEFAULT_NAMESPACE = 'common'
export const NAMESPACE_LIST = [
  'common',
  'settings',
  'terminal',
  'blueprint',
  'knowledge',
  'janus',
  'git',
  'editor',
  'notification',
  'llm',
  'model',
  'team',
  'plugins',
] as const

export type Namespace = (typeof NAMESPACE_LIST)[number]

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  'zh-CN': '简体中文',
  en: 'English',
}
