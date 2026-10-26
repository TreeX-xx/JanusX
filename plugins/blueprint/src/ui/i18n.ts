import english from './locales/en.json'

let locale = 'zh-CN'
export function setLocale(value: string) { locale = value; document.documentElement.lang = value }
/** Source-language keys stay readable; only product copy is passed here, never Note/model content. */
export function t(message: string, values: Record<string, string | number | undefined> = {}) {
  const translated = locale.toLowerCase().startsWith('zh') ? message : (english as Record<string, string>)[message] ?? message
  return translated.replace(/\{(\d+)\}/g, (_, key: string) => String(values[key] ?? ''))
}
