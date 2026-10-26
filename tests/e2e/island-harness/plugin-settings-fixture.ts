// Isolated synthetic market data for renderer lifecycle tests; no download or signature claim.
import blueprint from '../../../plugins/blueprint/manifest.json'
import { parsePluginManifest } from '../../../packages/plugin-sdk/src/index'
import type { PluginHostSnapshot } from '../../../src/shared/ipc/plugins'

export function installPluginSettingsFixture() {
  const manifest = parsePluginManifest(JSON.stringify(blueprint))
  const snapshot: PluginHostSnapshot = {
    developmentMode: false, plugins: [], logs: [],
    distribution: { configured: true, entries: [{ id: manifest.id, name: manifest.name,
      description: 'Synthetic Blueprint catalog fixture', version: manifest.version, publisher: 'JanusX', bytes: 1024, compatible: true }] },
  }
  window.electron.plugins = {
    onChanged: () => () => {}, onEvent: () => () => {},
    request: async input => {
      if (input.type === 'installOfficial') snapshot.plugins = [{ manifest, enabled: false, state: 'disabled',
        digest: 'synthetic-fixture', projects: [], failures: 0, source: { kind: 'official', directory: 'synthetic-fixture' } }]
      if (input.type === 'uninstall') snapshot.plugins = []
      if (input.type === 'enable' || input.type === 'disable') snapshot.plugins = snapshot.plugins.map(plugin => plugin.manifest.id !== input.id ? plugin
        : { ...plugin, enabled: input.type === 'enable', state: input.type === 'enable' ? 'ready' : 'disabled' })
      if (!['list', 'context', 'catalogRefresh', 'installOfficial', 'uninstall', 'enable', 'disable'].includes(input.type)) {
        throw new Error(`Unsupported fixture request: ${input.type}`)
      }
      return { ok: true, data: structuredClone(snapshot) }
    },
  }
}
