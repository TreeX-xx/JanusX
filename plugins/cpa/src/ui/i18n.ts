import { useSyncExternalStore } from 'react'
import zh from './zh-CN.json'
import en from './en.json'
let locale = 'en'
const listeners = new Set<() => void>()
export function setLocale(value: string): void { locale = value; for (const listener of listeners) listener() }
function translate(key: string, values?: Record<string, unknown>): string {
  let value: any = locale.startsWith('zh') ? zh : en
  for (const part of key.replace(/^common:/, '').split('.')) value = value?.[part]
  if (typeof value !== 'string') return key
  return value.replace(/\{\{(\w+)\}\}/g, (_all, name) => String(values?.[name] ?? ''))
}
export function useI18n(_namespace?: string) {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => locale)
  return { t: translate }
}

export function cpaError(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : String(failure)
  const keys: Record<string, string> = { 'cpa-port-in-use': 'portInUse', 'cpa-encryption-unavailable': 'encryptionUnavailable',
    'cpa-checksum-mismatch': 'checksumFailed', 'cpa-invalid-management-key': 'invalidKey', 'cpa-key-save-failed': 'keySaveFailed' }
  return translate(`common:cpa.${keys[message] ?? 'operationFailed'}`)
}
