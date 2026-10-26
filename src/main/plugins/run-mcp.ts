import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveInstalledPluginMcp } from './mcp-launcher'
import { allowLegacyImport } from './data-reset'
import trust from '../../../plugins/catalog/trust.json'
import application from '../../../package.json'

/** Both current and legacy launchers resolve local signed packages and acquire a lease. */
export async function runInstalledPluginMcp(pluginId: string, command: string) {
  if (!/^[a-z][a-z0-9.-]{2,127}$/.test(pluginId ?? '') || !/^[a-z][a-z0-9.-]{0,63}$/.test(command ?? '')) throw new Error('Invalid plugin MCP command.')
  const legacyState = process.env.JANUSX_NOTE_STATE_ROOT
  const directory = process.env.JANUSX_PLUGIN_HOME ?? (legacyState ? join(dirname(legacyState), 'plugins') : undefined)
  if (!directory) throw new Error('Open the plugin settings and register its MCP integration again.')
  const installed = await resolveInstalledPluginMcp({ directory: resolve(directory), pluginId, command,
    keys: trust.keys, nativePlugins: trust.nativePlugins, hostVersion: application.version, platform: `${process.platform}-${process.arch}` })
  process.env.JANUSX_PLUGIN_STATE_ROOT = installed.stateDirectory
  process.once('exit', installed.release)
  try {
    process.env.JANUSX_PLUGIN_APPLICATION_DATA_DIRECTORY = resolve(directory, '../..')
    process.env.JANUSX_PLUGIN_ALLOW_LEGACY_IMPORT = await allowLegacyImport(directory, pluginId) ? '1' : '0'
    await import(/* @vite-ignore */ pathToFileURL(installed.entry).href)
  }
  catch (cause) { installed.release(); throw cause }
}
