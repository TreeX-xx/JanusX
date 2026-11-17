import { describe, expect, it } from 'vitest'
import { resolveChatSelectionShortcut } from '../../src/renderer/src/components/janus/JanusChat'

function shortcut(key: string, overrides: Partial<Parameters<typeof resolveChatSelectionShortcut>[0]> = {}) {
  return resolveChatSelectionShortcut({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  })
}

describe('Janus Chat selection shortcuts', () => {
  it('leaves provider and model shortcuts unclaimed when Settings owns model selection', () => {
    const event = { key: 'Tab', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false }
    expect(resolveChatSelectionShortcut(event, false)).toBeNull()
    expect(resolveChatSelectionShortcut({ ...event, key: 'p', ctrlKey: true }, false)).toBeNull()
    expect(resolveChatSelectionShortcut({ ...event, key: 'P', metaKey: true }, false)).toBeNull()
    expect(resolveChatSelectionShortcut({ ...event, key: 'f', ctrlKey: true }, false)).toBe('permission')
  })
  it('opens providers with plain Tab', () => {
    expect(shortcut('Tab')).toBe('provider')
    expect(shortcut('Tab', { shiftKey: true })).toBeNull()
  })

  it('opens models with Ctrl+P or Cmd+P', () => {
    expect(shortcut('p', { ctrlKey: true })).toBe('model')
    expect(shortcut('P', { metaKey: true })).toBe('model')
  })

  it('opens permission modes with Ctrl+F or Cmd+F', () => {
    expect(shortcut('f', { ctrlKey: true })).toBe('permission')
    expect(shortcut('F', { metaKey: true })).toBe('permission')
  })

  it('does not claim composition or modified navigation keys', () => {
    expect(shortcut('Tab', { isComposing: true })).toBeNull()
    expect(shortcut('Tab', { altKey: true })).toBeNull()
    expect(shortcut('p')).toBeNull()
  })
})
