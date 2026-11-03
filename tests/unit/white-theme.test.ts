import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILT_IN_THEME_IDS } from '../../src/shared/ipc/theme'
import { defineTheme, getThemeDefinition, listThemeDefinitions, removeTheme } from '../../src/shared/theme/registry'
import { renderThemeCss } from '../../src/shared/theme/css-codegen'
import { createTerminalColorQueryResponder } from '../../src/shared/terminalColorQuery'
import { applyThemeToDocument } from '../../src/renderer/src/services/theme'
import { useBrowserOcclusionStore } from '../../src/renderer/src/stores/browser-occlusion'
import { pluginThemeSchema } from '../../packages/plugin-sdk/src/themes'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  return .2126 * r + .7152 * g + .0722 * b
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}
afterEach(() => { removeTheme('test-white-runtime'); vi.unstubAllGlobals(); useBrowserOcclusionStore.setState({ count: 0 }) })

describe('white theme', () => {
  it('is a distinct builtin with shared terminal/editor surfaces and an unchanged default', () => {
    expect(listThemeDefinitions().map(theme => theme.id)).toEqual([...BUILT_IN_THEME_IDS])
    const theme = getThemeDefinition('white')
    expect(theme.base).toBe('light')
    expect(theme.tokens['shell-canvas']).toBe('#ffffff')
    expect(theme.xterm.background).toBe(theme.tokens['shell-canvas'])
    expect(theme.monaco.colors['editor.background']).toBe(theme.xterm.background)
    expect(theme.monaco.base).toBe('vs')
    expect(getThemeDefinition(undefined).id).toBe('dark')
  })

  it('keeps small text and semantic feedback readable on white surfaces', () => {
    const { tokens } = getThemeDefinition('white')
    for (const surface of ['shell-canvas', 'shell-chrome', 'shell-pane-chrome', 'tool-canvas', 'popover-background']) {
      for (const foreground of ['shell-text', 'shell-muted', 'shell-dim', 'shell-accent', 'status-success', 'status-warning', 'status-danger', 'status-info', 'git-lane-blue', 'git-lane-purple', 'git-lane-green', 'git-lane-slate']) {
        expect(contrast(tokens[foreground], tokens[surface]), `${foreground} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast(tokens['on-accent'], tokens['shell-accent'])).toBeGreaterThanOrEqual(4.5)
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
      expect(contrast(tokens[`effort-${level}-color`], tokens['shell-canvas']), level).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('provides readable ANSI colors and answers terminal background probes as white', () => {
    const { xterm } = getThemeDefinition('white')
    expect(Object.keys(xterm)).toHaveLength(21)
    for (const [name, color] of Object.entries(xterm)) {
      if (['background', 'cursorAccent', 'selectionBackground'].includes(name)) continue
      expect(contrast(color, xterm.background), name).toBeGreaterThanOrEqual(4.5)
    }
    expect(createTerminalColorQueryResponder(() => 'white').push('\x1b]11;?\x1b\\')).toContain('rgb:ffff/ffff/ffff')
  })

  it('ships the same generated palette to the host and the portable plugin SDK', () => {
    const generated = renderThemeCss().replace(/\r\n/g, '\n')
    expect(readFileSync(resolve(__dirname, '../../packages/plugin-sdk/theme.css'), 'utf8').replace(/\r\n/g, '\n')).toBe(generated)
    expect(generated).toContain(":root, [data-theme='dark']")
    expect(generated).toContain('::selection {\n  background: var(--selection-background);')
    expect(generated).toContain('--terminal-background: #ffffff;')
  })

  it('applies runtime definitions and clears owned properties on fallback', () => {
    const values = new Map([['--unrelated', 'keep']])
    const root = { dataset: {} as Record<string, string>, style: {
      setProperty: (key: string, value: string) => values.set(key, value),
      removeProperty: (key: string) => values.delete(key), colorScheme: '',
    } }
    vi.stubGlobal('document', { documentElement: root })
    const base = getThemeDefinition('white')
    defineTheme({ ...base, id: 'test-white-runtime', tokens: { ...base.tokens, 'shell-canvas': '#f8fafc' } })
    applyThemeToDocument('test-white-runtime')
    expect(values.get('--shell-canvas')).toBe('#f8fafc')
    expect(values.get('--theme-color-scheme')).toBe('light')
    expect(values.get('--terminal-background')).toBe(base.xterm.background)
    expect(values.get('--terminal-brightBlue')).toBe(base.xterm.brightBlue)
    expect(root.style.colorScheme).toBe('light')
    expect(root.dataset.theme).toBe('test-white-runtime')
    useBrowserOcclusionStore.setState({ count: 1 })
    expect(values.get('--shell-canvas')).toBe('#f8fafc')
    defineTheme({ ...base, id: 'test-white-runtime', tokens: { ...base.tokens, 'shell-canvas': '#f1f5f9' } })
    expect(values.get('--shell-canvas')).toBe('#f1f5f9')
    applyThemeToDocument('unknown')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(values).toEqual(new Map([['--unrelated', 'keep']]))
  })

  it('allows authorized plugin palettes to inherit white', () => {
    expect(pluginThemeSchema.parse({ id: 'paper', title: 'Paper', base: 'white', colors: {
      canvas: '#ffffff', text: '#202936', muted: '#566171', card: '#f4f5f7', border: '#d8dde5', accent: '#b94a18',
    } }).base).toBe('white')
  })
})
