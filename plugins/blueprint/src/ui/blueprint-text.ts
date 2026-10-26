import zh from './locales/blueprint.zh.json'
import en from './locales/blueprint.en.json'

export function blueprintText(key: string, values: Record<string, string | number> = {}) {
  let value: unknown = document.documentElement.lang.toLowerCase().startsWith('zh') ? zh : en
  for (const part of key.replace(/^blueprint:/, '').split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
  return (typeof value === 'string' ? value : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''))
}
