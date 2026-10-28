import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  defineTheme,
  getThemeBase,
  getThemeDefinition,
  isKnownTheme,
  listThemeDefinitions,
  removeTheme,
} from '../../src/shared/theme/registry'
import { assertThemeCompleteness, getThemeTokens, SEMANTIC_TOKENS } from '../../src/shared/theme/tokens'
import { renderThemeCss } from '../../src/shared/theme/css-codegen'
import type { ThemeDefinition } from '../../src/shared/theme/definition'

describe('theme registry (M1 unified structure)', () => {
  it('ships dark + planche builtins with classic black as default', () => {
    const ids = listThemeDefinitions().map((d) => d.id)
    expect(ids).toContain('planche')
    expect(ids).toContain('dark')
    // 下拉顺序：经典黑第一，石板色第二
    expect(ids).toEqual(['dark', 'planche'])
    expect(getThemeDefinition(undefined).id).toBe('dark')
    expect(getThemeDefinition('dark').base).toBe('dark')
    expect(getThemeDefinition('planche').base).toBe('light')
  })

  it('falls back to default for unknown ids (never blank)', () => {
    expect(getThemeDefinition('no-such-theme').id).toBe('dark')
    expect(getThemeDefinition('light').id).toBe('dark')
    expect(isKnownTheme('planche')).toBe(true)
    expect(isKnownTheme('nope')).toBe(false)
    expect(getThemeBase('planche')).toBe('light')
    expect(getThemeBase('whatever')).toBe('dark')
  })

  it('lets third parties register without touching components', () => {
    const base = getThemeDefinition('dark')
    const sepia: ThemeDefinition = {
      ...base,
      id: 'theme-test-sepia',
      label: 'Sepia (test only)',
      tokens: { ...base.tokens, 'shell-canvas': '#f4ecd8' },
      monacoName: 'janusx-test-sepia',
    }
    defineTheme(sepia)
    try {
      expect(isKnownTheme('theme-test-sepia')).toBe(true)
      expect(getThemeDefinition('theme-test-sepia').tokens['shell-canvas']).toBe('#f4ecd8')
      expect(listThemeDefinitions().some((d) => d.id === 'theme-test-sepia')).toBe(true)
      // 未注册回落不受已注册的自定义主题影响
      expect(getThemeDefinition('nope').id).toBe('dark')
    } finally {
      removeTheme('theme-test-sepia')
      expect(isKnownTheme('theme-test-sepia')).toBe(false)
    }
  })

  it('covers every semantic token in every registered theme', () => {
    expect(SEMANTIC_TOKENS.length).toBeGreaterThan(30)
    const missing = assertThemeCompleteness()
    expect(missing).toEqual([])
  })

  it('covers status slots and ctx scale in every registered theme', () => {
    for (const definition of listThemeDefinitions()) {
      if (definition.id.startsWith('theme-test-')) continue
      for (const slot of ['running', 'wait', 'attention', 'degraded', 'error'] as const) {
        // 状态色允许 hex 或 rgba（wait 这类弱化态可用透明墨）
        expect(definition.status[slot].color, `${definition.id}:${slot}`).toMatch(/^(?:#(?:[0-9a-f]{6})|rgba?\()/i)
      }
      expect(definition.ctxScale.stops).toHaveLength(4)
    }
    // dark 刻度与历史三段锚点一致（宽裕青蓝→正常橙→警告红→逼近深红）
    expect(getThemeDefinition('dark').ctxScale.stops).toEqual(['#58a6ff', '#ff7830', '#ff5858', '#e02b2b'])
    // planche 刻度走纸面三色（深绿→赭黄→朱红）
    expect(getThemeDefinition('planche').ctxScale.stops).toEqual(['#2E6B5E', '#E5A422', '#D43D2A', '#A3281C'])
  })

  it('exposes tokens per theme for JS-driven surfaces', () => {
    expect(getThemeTokens('dark')['shell-canvas']).toBe('#151517')
    expect(getThemeTokens('planche')['shell-canvas']).toBe('#EFE4C5')
    expect(getThemeTokens('unknown')['shell-canvas']).toBe('#151517')
  })

  it('generates the checked-in CSS byte-identically (run npm run theme:css after editing definitions)', () => {
    const generated = renderThemeCss().replace(/\r\n/g, '\n')
    const checkedIn = readFileSync(
      resolve(__dirname, '../../src/renderer/src/styles/themes.generated.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(generated).toBe(checkedIn)
  })

  it('uses only hex colors in every registered monaco theme', () => {
    for (const definition of listThemeDefinitions()) {
      if (definition.id.startsWith('theme-test-')) continue
      for (const [key, value] of Object.entries(definition.monaco.colors)) {
        expect(value, `${definition.id}:${key}`).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i)
      }
    }
  })
})
