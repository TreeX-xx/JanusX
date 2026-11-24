// Isolated synthetic market data for renderer lifecycle tests; no download or signature claim.
import blueprint from '../../../plugins/blueprint/manifest.json'
import superagent from '../../../plugins/superagent/manifest.json'
import cpa from '../../../plugins/cpa/manifest.json'
import docker from '../../../plugins/docker/manifest.json'
import { parsePluginManifest } from '../../../packages/plugin-sdk/src/index'
import type { PluginHostSnapshot } from '../../../src/shared/ipc/plugins'

export function installPluginSettingsFixture() {
  const gallery = new URLSearchParams(location.search).has('plugin-gallery')
  const manifests = (gallery ? [blueprint, superagent, cpa, docker] : [blueprint]).map(raw => parsePluginManifest(JSON.stringify(raw)))
  const snapshot: PluginHostSnapshot = {
    developmentMode: false, plugins: [], logs: [],
    distribution: { configured: true, entries: manifests.map(manifest => ({
      id: manifest.id, name: manifest.name, description: manifest.description ?? '', version: manifest.version,
      publisher: 'JanusX', bytes: 1024, compatible: true,
    })) },
  }
  window.electron.plugins = {
    onChanged: () => () => {}, onEvent: () => () => {},
    request: async input => {
      if (input.type === 'installOfficial') {
        const manifest = manifests.find(item => item.id === input.id)
        if (!manifest) throw new Error('Unknown fixture plugin')
        snapshot.plugins.push({ manifest, enabled: false, state: 'disabled', digest: 'synthetic-fixture',
          projectScope: 'all', projects: [], failures: 0, source: { kind: 'official', directory: 'synthetic-fixture' } })
      }
      if (input.type === 'uninstall') snapshot.plugins = snapshot.plugins.filter(item => item.manifest.id !== input.id)
      if (input.type === 'enable' || input.type === 'disable') snapshot.plugins = snapshot.plugins.map(plugin => plugin.manifest.id !== input.id ? plugin
        : { ...plugin, enabled: input.type === 'enable', state: input.type === 'enable' ? 'ready' : 'disabled' })
      if (!['list', 'context', 'catalogRefresh', 'installOfficial', 'uninstall', 'enable', 'disable'].includes(input.type)) {
        throw new Error(`Unsupported fixture request: ${input.type}`)
      }
      return { ok: true, data: structuredClone(snapshot) }
    },
  }
}
