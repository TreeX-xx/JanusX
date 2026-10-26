import { join, resolve, relative } from 'node:path'
import { readFile } from 'node:fs/promises'
import { PLUGIN_API_VERSION } from '@janusx/plugin-sdk'
import { readPluginPackage } from './files'
import { verifyPluginRelease, assertPluginCompatibility, type PluginTrustKeys } from './distribution/package'
import { permissionFingerprint } from './permission-fingerprint'
import { leasePluginPackage, withPluginPackageLock } from './package-leases'

/** Resolve only a locally installed, verified, explicitly enabled native MCP contribution. Never download. */
export async function resolveInstalledPluginMcp(options: { directory: string; pluginId: string; command: string;
  keys: PluginTrustKeys; nativePlugins: Readonly<Record<string, readonly string[]>>; hostVersion: string; platform: string }) {
  return withPluginPackageLock(options.directory, async () => {
    const registry = JSON.parse(await readFile(join(options.directory, 'registry.json'), 'utf8'))
    const candidates = Array.isArray(registry.plugins) ? registry.plugins.filter((record: any) => record.manifest?.id === options.pluginId) : []
    if (candidates.length !== 1) throw new Error('Install the official Blueprint plugin in Settings > Plugins > Discover first.')
    const record = candidates[0]
    if (!record.enabled) throw new Error('Enable the official Blueprint plugin before using Note MCP.')
    if (record.source?.kind !== 'official' || !record.release || !options.nativePlugins[options.pluginId]?.includes(record.release.keyId)) throw new Error('The plugin signing identity is not trusted.')
    const packageId = relative(resolve(options.directory, 'packages'), resolve(record.packageDirectory))
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(packageId)) throw new Error('The installed package is not host-owned.')
    const release = verifyPluginRelease(record.release, options.keys)
    assertPluginCompatibility(release, options.hostVersion, PLUGIN_API_VERSION, options.platform)
    const pkg = await readPluginPackage(record.packageDirectory)
    if (release.id !== options.pluginId || pkg.manifest.id !== release.id || release.version !== pkg.manifest.version
      || release.pluginApi !== pkg.manifest.engines.pluginApi || release.contentDigest !== pkg.digest || permissionFingerprint(pkg.manifest) !== record.grant) throw new Error('The installed package changed; reinstall or confirm its permissions in Settings > Plugins.')
    const contribution = pkg.manifest.native?.mcp
    if (!contribution || contribution.command !== options.command) throw new Error('The installed plugin does not provide this MCP command.')
    const releaseLease = await leasePluginPackage(options.directory, record.packageDirectory)
    return { entry: join(record.packageDirectory, contribution.entry), release: releaseLease,
      stateDirectory: join(options.directory, 'data', options.pluginId, 'native') }
  })
}
