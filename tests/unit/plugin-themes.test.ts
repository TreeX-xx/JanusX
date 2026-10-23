import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parsePluginManifest, pluginThemeSchema, PLUGIN_CAPABILITIES } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { syncPluginThemes } from '../../src/shared/theme/plugin-themes'
import { getThemeDefinition, listThemeDefinitions } from '../../src/shared/theme/registry'
import { applyThemeToDocument } from '../../src/renderer/src/services/theme'
import { useBrowserOcclusionStore } from '../../src/renderer/src/stores/browser-occlusion'
import { defineJanusxThemes, getMonacoThemeName } from '../../src/renderer/src/lib/monaco-theme'

const colors = { canvas: '#102030', text: '#f5f5f5', muted: '#b0c0d0', card: '#203040', border: '#607080', accent: '#80c0ff' }
const palette = () => ({ id: 'ocean', title: 'Ocean', base: 'dark' as const, colors: { ...colors } })
const manifest = () => parsePluginManifest(JSON.stringify({ schemaVersion: 1, id: 'example.palette', name: 'Palette', version: '1.0.0', engines: { pluginApi: '^1.0.0' },
  capabilities: { required: ['themes.palette'], optional: [] }, permissions: [{ name: 'ui.themes' }], contributes: { views: [], themes: [palette()] } }))
const id = 'plugin:example.palette/ocean'
const cleanups: Array<() => unknown> = []
afterEach(async () => { syncPluginThemes([]); vi.unstubAllGlobals(); vi.restoreAllMocks(); useBrowserOcclusionStore.setState({ count: 0 }); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('P7 declarative palettes', () => {
  it('registers palettes arriving after Monaco mounts and resolves revoked selections to builtin', () => {
    const monaco = { editor: { defineTheme: vi.fn() } }
    defineJanusxThemes(monaco)
    syncPluginThemes([manifest()])
    const name = getMonacoThemeName(id)
    expect(monaco.editor.defineTheme).toHaveBeenCalledWith(name, expect.objectContaining({ colors: expect.objectContaining({ 'editor.background': colors.canvas }) }))
    syncPluginThemes([])
    expect(getMonacoThemeName(id)).toBe('janusx-planche')
  })
  it('accepts manifest-only themes and requires explicit capability and permission', () => {
    const data = manifest(); expect(data.contributes.views).toEqual([])
    expect(() => parsePluginManifest(JSON.stringify({ ...data, permissions: [] }))).toThrow()
    expect(() => parsePluginManifest(JSON.stringify({ ...data, capabilities: { required: [], optional: ['themes.palette'] } }))).toThrow()
    expect(() => parsePluginManifest(JSON.stringify(data), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'themes.palette') })).toThrow()
  })
  it.each(['url(https://example.com/a)', 'var(--secret)', '#fff', '#ffffff00', 'red', '#123456;display:none'])('rejects executable or non-opaque color %s', value => {
    expect(() => pluginThemeSchema.parse({ ...palette(), colors: { ...colors, canvas: value } })).toThrow()
  })
  it.each(['css', 'entry', 'unknownColor', 'contrast', 'duplicate', 'count', 'reserved', 'empty'])('rejects invalid declaration %s', kind => {
    const data: any = manifest(); const theme = data.contributes.themes[0]
    if (kind === 'css') theme.css = 'body{display:none}'
    if (kind === 'entry') theme.entry = 'theme.js'
    if (kind === 'unknownColor') theme.colors['dialog-backdrop'] = '#000000'
    if (kind === 'contrast') theme.colors.text = theme.colors.canvas
    if (kind === 'duplicate') data.contributes.themes.push(theme)
    if (kind === 'count') data.contributes.themes = Array.from({ length: 5 }, (_, index) => ({ ...theme, id: `color-${index}` }))
    if (kind === 'reserved') theme.id = 'planche/../../dark'
    if (kind === 'empty') data.contributes.themes = []
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
  })
  it('namespaces ids, preserves builtins, and derives terminal/editor colors with valid Monaco names', () => {
    const data = manifest(); const base = getThemeDefinition('dark')
    syncPluginThemes([data, { ...data, id: 'another.palette' }])
    const theme = getThemeDefinition(id)
    expect(theme.tokens['shell-canvas']).toBe(colors.canvas); expect(theme.xterm.background).toBe(colors.canvas)
    expect(theme.monaco.colors['editor.foreground']).toBe(colors.text); expect(theme.monacoName).toMatch(/^[a-z0-9-]+$/)
    expect(getThemeDefinition('plugin:another.palette/ocean').monacoName).not.toBe(theme.monacoName)
    expect(getThemeDefinition('dark')).toBe(base); expect(theme.tokens['dialog-backdrop']).toBe(base.tokens['dialog-backdrop'])
    syncPluginThemes([]); expect(getThemeDefinition(id).id).toBe('planche'); expect(listThemeDefinitions().map(item => item.id)).toEqual(['planche', 'dark'])
  })
  it('does not register an ungranted theme or accept invalid palette data at the renderer boundary', () => {
    syncPluginThemes([{ ...manifest(), permissions: [] }]); expect(getThemeDefinition(id).id).toBe('planche')
    const data = manifest(); data.contributes.themes![0].colors.canvas = 'url(evil)'
    expect(() => syncPluginThemes([data])).toThrow(); expect(getThemeDefinition(id).id).toBe('planche')
  })
  it('shields overlapping host dialogs and removes only owned inline variables on fallback', () => {
    const values = new Map([['--unrelated', 'keep']]); const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => values.set(k, v), removeProperty: (k: string) => values.delete(k), colorScheme: '' } }
    vi.stubGlobal('document', { documentElement: root }); syncPluginThemes([manifest()]); applyThemeToDocument(id)
    expect(root.dataset.theme).toBe('dark'); expect(values.get('--shell-canvas')).toBe(colors.canvas)
    useBrowserOcclusionStore.setState({ count: 2 }); expect(values.has('--shell-canvas')).toBe(false)
    useBrowserOcclusionStore.setState({ count: 1 }); expect(values.has('--shell-canvas')).toBe(false)
    useBrowserOcclusionStore.setState({ count: 0 }); expect(values.get('--shell-canvas')).toBe(colors.canvas)
    syncPluginThemes([]); applyThemeToDocument(id); expect(root.dataset.theme).toBe('planche'); expect(root.dataset.pluginTheme).toBe('')
    expect(values).toEqual(new Map([['--unrelated', 'keep']]))
  })
  it('requires renewed authorization when a palette changes and keeps configuration separate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'janusx-palette-')); cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
    const source = join(directory, 'source'); await mkdir(source); const data = manifest()
    await writeFile(join(source, 'manifest.json'), JSON.stringify(data))
    const service = new PluginService({ directory: join(directory, 'profile'), resolveProject: async () => ({ root: directory, name: 'Project' }), changed() {}, event() {}, closed() {}, openView() {}, toast() {} })
    cleanups.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true); await service.import(source, 'linked'); await service.enable(data.id, [])
    expect(service.snapshot().plugins[0].state).toBe('ready'); expect(service.snapshot().plugins[0].runtime?.pages).toBe(0)
    data.contributes.themes![0].colors.accent = '#90d0ff'; await writeFile(join(source, 'manifest.json'), JSON.stringify(data)); await service.reload(data.id)
    expect(service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
    await service.enable(data.id, []); expect(service.snapshot().plugins[0].enabled).toBe(true)
  })
})
