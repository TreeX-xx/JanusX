import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyTerminalDraftLifecycle,
  clampDrawerHeight,
  DRAWER_DEFAULT_HEIGHT,
  DRAWER_MIN_HEIGHT,
  formatNoteAge,
  getDrawerHeight,
  getDrawerPanelId,
  shouldRemoveTerminalDrafts,
} from '../../../src/renderer/src/components/note/quick-note-behavior'
import { getDraftsByScope, useDraftCardStore } from '../../../src/renderer/src/stores/draft-card'

describe('Quick Note view behavior', () => {
  it('suppresses only the content editor perimeter focus highlight', () => {
    const css = readFileSync(new URL('../../../src/renderer/src/components/note/QuickNote.module.css', import.meta.url), 'utf8')
    expect(css).toContain('.editor textarea:focus { outline:none; box-shadow:none; }')
    expect(css).not.toMatch(/(?:input|button):focus[^{}]*\{[^}]*outline:\s*none/)
  })

  it('keeps export formats in an accessible conditional menu', () => {
    const source = readFileSync(new URL('../../../src/renderer/src/components/note/QuickNote.tsx', import.meta.url), 'utf8')

    expect(source.match(/aria-haspopup="menu"/g)).toHaveLength(1)
    expect(source).toContain("{t('terminal:note.export')}")
    expect(source).toContain('aria-expanded={exportOpen}')
    expect(source).toContain('{exportOpen && (')
    expect(source).toContain('role="menu" aria-label="Export format"')
    expect(source).toContain("{ format: 'md', label: 'Markdown (.md)' }")
    expect(source).toContain("{ format: 'txt', label: 'Plain text (.txt)' }")
    expect(source).toContain("{ format: 'html', label: 'HTML (.html)' }")
    expect(source).toContain("if (event.key !== 'Escape') return")
    expect(source).toContain('if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExportOpen(false)')
  })

  it('reads drafts by scope rather than by terminal', () => {
    const source = readFileSync(new URL('../../../src/renderer/src/components/note/QuickNote.tsx', import.meta.url), 'utf8')
    expect(source).toContain('getDraftsByScope(state, scopeId)')
    expect(source).toContain('state.activeDraftIdByScope[scopeId]')
    expect(source).not.toContain('terminalId={')
    // 没有终端时"粘贴到终端"整个按钮不渲染，而不是留一个必然后患的空调用。
    expect(source).toContain('{onPasteToTerminal && (')
  })

  it('uses the specified collapsed and runtime drawer heights', () => {
    expect(getDrawerHeight(false)).toBe('28px')
    expect(getDrawerHeight(true)).toBe(`${DRAWER_DEFAULT_HEIGHT}px`)
    expect(getDrawerHeight(true, 300)).toBe('300px')
  })

  it('clamps a user height between the floor and the pane reserve', () => {
    expect(clampDrawerHeight(40, 500)).toBe(DRAWER_MIN_HEIGHT)
    expect(clampDrawerHeight(900, 500)).toBe(500)
    expect(clampDrawerHeight(333.6, 500)).toBe(334)
    expect(clampDrawerHeight(300, 50)).toBe(DRAWER_MIN_HEIGHT)
  })

  it('gives the single runtime drawer panel a stable id', () => {
    expect(getDrawerPanelId()).toBe('drawer-runtime-panel')
  })

  it('keeps drafts through every terminal lifecycle event', () => {
    // 草稿归属已改为工作区/全局作用域：结束终端只是关闭呈现。
    expect(shouldRemoveTerminalDrafts('kill-removed')).toBe(false)
    expect(shouldRemoveTerminalDrafts('exit')).toBe(false)
    expect(shouldRemoveTerminalDrafts('workspace-switch')).toBe(false)

    useDraftCardStore.getState().clearAll()
    useDraftCardStore.getState().addDraft('workspace-1', 'killed')
    useDraftCardStore.getState().addDraft('workspace-1', 'exited')
    useDraftCardStore.getState().addDraft('workspace-1', 'switched')
    applyTerminalDraftLifecycle('kill-removed', 'killed')
    applyTerminalDraftLifecycle('exit', 'exited')
    applyTerminalDraftLifecycle('workspace-switch', 'switched')
    expect(getDraftsByScope(useDraftCardStore.getState(), 'workspace-1')).toHaveLength(3)
  })

  it('formats draft update times for the list metadata', () => {
    const now = Date.UTC(2026, 6, 13, 12)
    expect(formatNoteAge(now - 30_000, now)).toBe('just now')
    expect(formatNoteAge(now - 3 * 60_000, now)).toBe('3m ago')
    expect(formatNoteAge(now - 2 * 60 * 60_000, now)).toBe('2h ago')
    expect(formatNoteAge(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago')
  })

  it('groups drafts by scope so two terminals in one workspace share a list', () => {
    useDraftCardStore.getState().clearAll()
    useDraftCardStore.getState().addDraft('workspace-1', 'terminal-a')
    useDraftCardStore.getState().addDraft('workspace-1', 'terminal-b')
    expect(getDraftsByScope(useDraftCardStore.getState(), 'workspace-1')).toHaveLength(2)
    expect(useDraftCardStore.getState().drafts['terminal-a']).toBeUndefined()
  })
})
