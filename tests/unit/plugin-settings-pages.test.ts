import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePluginManifest, PLUGIN_CAPABILITIES, type PluginManifest } from '../../packages/plugin-sdk/src/index'
import { installedPluginSettings } from '../../src/renderer/src/extensions/plugin-settings'
import type { InstalledPlugin, PluginHostSnapshot } from '../../src/shared/ipc/plugins'
import { permissionFingerprint } from '../../src/main/plugins/permission-fingerprint'

const manifest = (): PluginManifest => {
  const value = JSON.parse(readFileSync('packages/plugin-sdk/template/manifest.json', 'utf8'))
  value.capabilities.required.push('views.settings')
  value.contributes.views.push({ id: 'settings', title: 'Reference settings', location: 'settings', scope: 'application', instancePolicy: 'single', entry: 'dist/index.html' })
  return value
}
const parse = (value: unknown) => parsePluginManifest(JSON.stringify(value))
const record = (): InstalledPlugin => ({ manifest: parse(manifest()), source: { kind: 'official', directory: 'verified' },
  enabled: false, state: 'disabled', digest: 'fixture', projects: [], failures: 0 })
const snapshot = (plugins: InstalledPlugin[], developmentMode = false): PluginHostSnapshot => ({ plugins, developmentMode, logs: [] })

describe('installed plugin settings pages', () => {
  it('requires the settings capability and UI authorization, and rejects project or multiple settings instances', () => {
    expect(parse(manifest()).contributes.views.at(-1)?.location).toBe('settings')
    for (const mutate of [
      (m: PluginManifest) => { m.capabilities.required = m.capabilities.required.filter(cap => cap !== 'views.settings') },
      (m: PluginManifest) => { m.permissions = m.permissions.filter(permission => permission.name !== 'ui.views.open') },
      (m: PluginManifest) => { m.contributes.views.at(-1)!.scope = 'project' },
      (m: PluginManifest) => { m.contributes.views.at(-1)!.instancePolicy = 'multiple' },
    ]) { const value = manifest(); mutate(value); expect(() => parse(value)).toThrow() }
    expect(() => parsePluginManifest(JSON.stringify(manifest()), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(cap => cap !== 'views.settings') })).toThrow()
  })

  it('adds settings only after activation, removes them on disable, and removes them on uninstall', () => {
    expect(installedPluginSettings(snapshot([]))).toEqual([])
    const plugin = record()
    expect(installedPluginSettings(snapshot([plugin]))).toEqual([])
    plugin.enabled = true; plugin.state = 'ready'
    expect(installedPluginSettings(snapshot([plugin]))).toMatchObject([{ id: `extension:${plugin.manifest.id}/settings`, enabled: true }])
    plugin.enabled = false; plugin.state = 'disabled'
    expect(installedPluginSettings(snapshot([plugin]))).toEqual([])
    expect(installedPluginSettings(snapshot([]))).toEqual([])
  })

  it('requires renewed consent when settings page declarations change', () => {
    const value = parse(manifest())
    const original = permissionFingerprint(value)
    value.contributes.views.at(-1)!.entry = 'dist/settings.html'
    expect(permissionFingerprint(value)).not.toBe(original)
    value.contributes.views.at(-1)!.entry = 'dist/index.html'
    expect(permissionFingerprint(value)).toBe(original)
  })

  it('does not expose hidden development sources or execute blocked plugin pages', () => {
    const plugin = record()
    plugin.source = { kind: 'linked', directory: 'development' }
    plugin.enabled = true; plugin.state = 'ready'
    expect(installedPluginSettings(snapshot([plugin]))).toEqual([])
    expect(installedPluginSettings(snapshot([plugin], true))).toHaveLength(1)
    plugin.state = 'blocked'
    expect(installedPluginSettings(snapshot([plugin], true))[0].enabled).toBe(false)
  })
})
