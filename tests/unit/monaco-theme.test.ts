import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  defineJanusxDarkTheme,
  defineJanusxThemes,
  getMonacoThemeName,
  JANUSX_DARK_THEME,
  JANUSX_DARK_THEME_NAME,
  JANUSX_PLANCHE_THEME,
  JANUSX_PLANCHE_THEME_NAME,
} from '../../src/renderer/src/lib/monaco-theme'

const readSource = (relativePath: string) =>
  readFileSync(resolve(__dirname, '../../src/renderer/src', relativePath), 'utf8')

describe('monaco theme', () => {
  it('registers under the shared name', () => {
    const defineTheme = vi.fn()
    defineJanusxDarkTheme({ editor: { defineTheme } })

    expect(defineTheme).toHaveBeenCalledWith(JANUSX_DARK_THEME_NAME, JANUSX_DARK_THEME)
  })

  it('registers both dark and planche themes together', () => {
    const defineTheme = vi.fn()
    defineJanusxThemes({ editor: { defineTheme } })

    expect(defineTheme).toHaveBeenCalledWith(JANUSX_DARK_THEME_NAME, JANUSX_DARK_THEME)
    expect(defineTheme).toHaveBeenCalledWith(JANUSX_PLANCHE_THEME_NAME, JANUSX_PLANCHE_THEME)
  })

  it('routes planche to the light theme and unknown ids to the classic black default', () => {
    expect(getMonacoThemeName('planche')).toBe(JANUSX_PLANCHE_THEME_NAME)
    expect(getMonacoThemeName('dark')).toBe(JANUSX_DARK_THEME_NAME)
    expect(getMonacoThemeName('light')).toBe(JANUSX_DARK_THEME_NAME)
    expect(getMonacoThemeName(undefined)).toBe(JANUSX_DARK_THEME_NAME)
  })

  it('planche uses hex colors only and paper background', () => {
    for (const [key, value] of Object.entries(JANUSX_PLANCHE_THEME.colors)) {
      expect(value, key).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i)
    }
    const colors = JANUSX_PLANCHE_THEME.colors as Record<string, string>
    expect(colors['editor.background']).toBe('#EFE4C5')
    expect(colors['editorCursor.foreground']).toBe('#D43D2A')
  })

  it('uses hex colors only — Monaco silently drops rgba() strings', () => {
    for (const [key, value] of Object.entries(JANUSX_DARK_THEME.colors)) {
      expect(value, key).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i)
    }
  })

  it('themes the find widget so its chrome is not left at vs-dark defaults', () => {
    const colors = JANUSX_DARK_THEME.colors as Record<string, string>

    expect(colors['editorWidget.background']).toBeDefined()
    expect(colors['input.background']).toBeDefined()
    expect(colors['inputOption.activeBorder']).toBeDefined()
    expect(colors['editor.findMatchBackground']).toBeDefined()
  })

  it('uses restrained full-line diff colors and stronger local change markers', () => {
    const colors = JANUSX_DARK_THEME.colors as Record<string, string>

    for (const change of ['inserted', 'removed']) {
      const lineAlpha = parseInt(colors[`diffEditor.${change}LineBackground`].slice(7), 16)
      const textAlpha = parseInt(colors[`diffEditor.${change}TextBackground`].slice(7), 16)
      expect(lineAlpha).toBeGreaterThan(0)
      expect(lineAlpha).toBeLessThan(textAlpha)
      expect(textAlpha).toBeLessThan(128)
    }
  })

  it('is defined in exactly one viewer and reused by markdown and html', () => {
    const monacoViewer = readSource('components/viewers/MonacoViewer.tsx')
    expect(monacoViewer).toContain('defineJanusxThemes(monaco)')
    expect(monacoViewer).not.toContain('monaco.editor.defineTheme(')
    expect(monacoViewer).toContain('getMonacoThemeName(appTheme)')

    for (const viewer of ['components/viewers/MarkdownViewer.tsx', 'components/viewers/HtmlViewer.tsx']) {
      const source = readSource(viewer)
      expect(source, viewer).toContain("import { MonacoViewer } from './MonacoViewer'")
      expect(source, viewer).not.toContain('monaco.editor.defineTheme(')
    }
  })
})

describe('file viewer diff routing', () => {
  it('keeps markdown and html viewers while passing the baseline into their editor pane', () => {
    const source = readSource('components/FileViewerContent.tsx')

    expect(source).not.toContain("['code', 'markdown', 'html'].includes(file.viewType)")
    expect(source).toMatch(/<MarkdownViewer[\s\S]*?originalContent=\{diffOriginalContent\}/)
    expect(source).toMatch(/<HtmlViewer[\s\S]*?originalContent=\{diffOriginalContent\}/)
  })
})

describe('find widget hit-testing (globals.css)', () => {
  const css = readFileSync(
    resolve(__dirname, '../../src/renderer/src/styles/globals.css'),
    'utf8',
  )

  it('keeps the option toggles in the hit-test layer, not just the buttons', () => {
    expect(css).toContain('.monaco-editor .find-widget .monaco-custom-toggle')
    expect(css).toContain('.monaco-editor .find-widget .monaco-findInput > .controls')
  })

  it('drops transient hover labels out of hit-testing at the top of the overlay chain', () => {
    // The overlay is .context-view > .workbench-hover-container > .monaco-hover. Neutralizing only
    // the inner hover leaves the positioned .context-view wrapper intercepting clicks, which is
    // what kept the close button and option toggles unclickable. pointer-events inherits, so the
    // rule belongs on the wrapper.
    expect(css).toContain(
      '.context-view:has(> .workbench-hover-container:not(.locked))',
    )
    expect(css).toMatch(
      /\.context-view:has\(> \.workbench-hover-container:not\(\.locked\)\) \{\s*visibility: hidden !important;\s*pointer-events: none !important;/,
    )
  })

  it('hides the label with visibility, not display, so Monaco can still measure it', () => {
    expect(css).not.toMatch(
      /\.context-view:has\(> \.workbench-hover-container:not\(\.locked\)\) \{\s*display: none/,
    )
  })

  it('centers the close button in the same 25px row as the other actions', () => {
    expect(css).toContain('top: calc(3px + (25px - 22px) / 2)')
  })
})

/**
 * The hover fix above is CSS against Monaco's internal DOM, so it can only stay correct while that
 * DOM keeps its shape. These assertions read the installed Monaco and fail loudly on upgrade if any
 * link in the chain is renamed — cheaper than rediscovering the flicker by hand.
 */
describe('monaco hover overlay contract (pins the DOM the fix relies on)', () => {
  const monacoVs = resolve(__dirname, '../../node_modules/monaco-editor/esm/vs')
  const readMonaco = (relativePath: string) =>
    readFileSync(resolve(monacoVs, relativePath), 'utf8')

  it('renders hovers into a ContextView classed .context-view', () => {
    expect(readMonaco('platform/hover/browser/hoverService.js')).toContain('showContextView')
    expect(readMonaco('base/browser/ui/contextview/contextview.js')).toContain("$('.context-view')")
  })

  it('wraps the hover in .workbench-hover-container and toggles .locked on it', () => {
    const hoverWidget = readMonaco('platform/hover/browser/hoverWidget.js')

    expect(hoverWidget).toContain('workbench-hover-container')
    expect(hoverWidget).toContain("classList.toggle('locked'")
  })

  it('still resets pointer-events on .context-view.fixed, so !important stays required', () => {
    expect(readMonaco('base/browser/ui/contextview/contextview.css')).toMatch(
      /\.context-view\.fixed \{\s*all: initial;/,
    )
  })

  it('never re-enables pointer-events inside the hover subtree', () => {
    // If Monaco ever sets pointer-events: auto on a hover descendant, inheritance no longer covers
    // the whole subtree and the single root rule stops being sufficient.
    for (const file of [
      'platform/hover/browser/hover.css',
      'base/browser/ui/hover/hoverWidget.css',
    ]) {
      expect(readMonaco(file), file).not.toMatch(/pointer-events:\s*auto/)
    }
  })

  it('keeps the find controls on the class names the hit-test rule lists', () => {
    expect(readMonaco('base/browser/ui/toggle/toggle.js')).toContain("'monaco-custom-toggle'")
    expect(readMonaco('base/browser/ui/findinput/findInput.css')).toContain(
      '.monaco-findInput > .controls',
    )
    expect(readMonaco('editor/contrib/find/browser/findWidget.css')).toContain(
      '.button.codicon-widget-close',
    )
  })
})
