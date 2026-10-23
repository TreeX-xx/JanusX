// Note: .agents/notes/workbench/plugin-contract-v1.md — bounded palette registration and removal.
import type { PluginManifest } from '@janusx/plugin-sdk'
import { pluginThemeSchema } from '@janusx/plugin-sdk'
import { defineTheme, getThemeDefinition, removeTheme } from './registry'

const registered = new Set<string>()
export function syncPluginThemes(manifests: PluginManifest[]): void {
  for (const id of registered) removeTheme(id)
  registered.clear()
  for (const manifest of manifests) {
    if (!manifest.capabilities.required.includes('themes.palette') || !manifest.permissions.some(item => item.name === 'ui.themes')) continue
    for (const input of manifest.contributes.themes ?? []) {
      const palette = pluginThemeSchema.parse(input)
      const base = getThemeDefinition(palette.base)
      const id = `plugin:${manifest.id}/${palette.id}`
      const { canvas, text, muted, card, border, accent } = palette.colors
      const overrides: Record<string, string> = {}
      for (const key of ['shell-void', 'shell-canvas', 'shell-pane', 'shell-chrome', 'shell-pane-chrome', 'shell-drawer', 'bg-app', 'bg-deep', 'bg-dark', 'bg-darker', 'workbench-canvas', 'tool-canvas', 'paper']) overrides[key] = canvas
      for (const key of ['shell-card', 'shell-chrome-raised', 'shell-hover', 'shell-active', 'tool-card', 'tool-chrome', 'tool-hover', 'popover-background', 'popover-hover', 'surface', 'surface-elevated', 'chrome-bg']) overrides[key] = card
      for (const key of ['shell-text', 'text', 'ink']) overrides[key] = text
      for (const key of ['shell-muted', 'shell-dim', 'text-secondary', 'text-dim', 'ink-soft', 'ink-faint']) overrides[key] = muted
      for (const key of ['shell-border', 'shell-border-soft', 'border', 'border-soft', 'line', 'line-soft', 'control-border']) overrides[key] = border
      for (const key of ['shell-accent', 'shell-accent-strong', 'primary', 'planche-red']) overrides[key] = accent
      defineTheme({ ...base, id, label: `${manifest.name} · ${palette.title} [${manifest.id}]`, pluginBase: palette.base, overrides,
        tokens: { ...base.tokens, ...overrides }, xterm: { ...base.xterm, background: canvas, foreground: text, cursor: accent, cursorAccent: canvas },
        monacoName: `janusx-plugin-${Array.from(id).map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`, monaco: { ...base.monaco, colors: { ...base.monaco.colors, 'editor.background': canvas, 'editor.foreground': text,
          'editorCursor.foreground': accent } } })
      registered.add(id)
    }
  }
}
