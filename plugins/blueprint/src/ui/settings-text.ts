import zh from './locales/settings.zh.json'
import en from './locales/settings.en.json'

/** Preserve the original settings copy and interpolation in the independent UI. */
export function settingsText(key: string, values: Record<string, string | number> = {}) {
  const path = key.replace(/^blueprint:review\./, '').split('.')
  let value: unknown = document.documentElement.lang.toLowerCase().startsWith('zh') ? zh : en
  for (const part of path) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  return (typeof value === 'string' ? value : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''))
}
