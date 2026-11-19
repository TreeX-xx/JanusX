import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, addEventListener: () => {} })
  return values
})
import { useConversationPreferences } from '../../src/renderer/src/stores/conversation-preferences'
import { applyThemeToDocument } from '../../src/renderer/src/services/theme'

const properties = new Map<string, string>()
beforeEach(() => {
  useConversationPreferences.setState({ initialView: 'terminal', emphasisColors: {} })
  saved.clear(); properties.clear()
  vi.stubGlobal('document', { documentElement: { dataset: {}, style: { colorScheme: '', setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) } } })
  applyThemeToDocument('dark')
})
afterEach(() => { vi.stubGlobal('document', undefined) })

it('restores older preferences and drops malformed saved colors without changing the launch view', async () => {
  saved.set('janusx-conversation-launch', JSON.stringify({ version: 1, state: { initialView: 'conversation' } }))
  await useConversationPreferences.persist.rehydrate()
  expect(useConversationPreferences.getState()).toMatchObject({ initialView: 'conversation', emphasisColors: {} })
  saved.set('janusx-conversation-launch', JSON.stringify({ version: 1, state: { initialView: 'conversation', emphasisColors: { dark: '#8bf', white: 'url(unsafe)', planche: 123 } } }))
  await useConversationPreferences.persist.rehydrate()
  expect(useConversationPreferences.getState()).toMatchObject({ initialView: 'conversation', emphasisColors: { dark: '#88BBFF' } })
  expect(properties.get('--conversation-emphasis')).toBe('#88BBFF')
})

it('applies the active theme color immediately and resets only that theme', () => {
  const { setEmphasisColor } = useConversationPreferences.getState()
  setEmphasisColor('dark', '#98b7ef'); setEmphasisColor('white', '#375d8b')
  expect(properties.get('--conversation-emphasis')).toBe('#98B7EF')
  applyThemeToDocument('white')
  expect(properties.get('--conversation-emphasis')).toBe('#375D8B')
  setEmphasisColor('white', 'invalid')
  expect(properties.get('--conversation-emphasis')).toBe('#375D8B')
  setEmphasisColor('white', null)
  expect(properties.has('--conversation-emphasis')).toBe(false)
  expect(JSON.parse(saved.get('janusx-conversation-launch')!).state.emphasisColors).toEqual({ dark: '#98B7EF' })
  applyThemeToDocument('dark')
  expect(properties.get('--conversation-emphasis')).toBe('#98B7EF')
})
