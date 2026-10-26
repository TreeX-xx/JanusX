import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { InstalledPlugin } from '../../shared/ipc/plugins'
import { NativeServiceError, type NativeHandler } from '@janusx/plugin-sdk'
import { NativePluginService } from './native-service'
import { nativeAgentHost } from './native-agent'
import { nativeModelsHost, type NativeModelCredentials } from './native-models'

/** Called only after PluginService verifies the package, signer allowlist and explicit native grant. */
export function createOfficialNativeService(record: InstalledPlugin, directory: string, stopped: (code: string) => void,
  resolveProject: (id: string, root: string | null) => Promise<{ root: string; name: string }>, credentials: NativeModelCredentials, extraHost?: NativeHandler): NativePluginService {
  if (record.source.kind !== 'official' || !record.manifest.native) throw new NativeServiceError('NATIVE_TRUST_REQUIRED')
  const entry = record.manifest.native.entry
  const agent = nativeAgentHost(record, () => service, resolveProject)
  const models = nativeModelsHost(record, credentials)
  const service = new NativePluginService({ stopped, host: (method, value, signal) => method === 'agent.run' ? agent(method, value, signal)
    : method === 'mcp.launch' && record.manifest.native?.mcp ? Promise.resolve({
      launch: { command: app.isPackaged ? process.execPath : 'node',
        args: [join(app.isPackaged ? app.getAppPath() : process.env.JANUSX_DEV_BUILD_ROOT ?? join(app.getAppPath(), 'out'),
          ...(app.isPackaged ? ['out', 'main'] : ['main']), 'plugin-mcp.js'), record.manifest.id, record.manifest.native.mcp.command],
        env: { ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}), JANUSX_PLUGIN_HOME: join(app.getPath('userData'), 'janusx', 'plugins') } },
      directories: { home: homedir(), ...(process.env.CODEX_HOME ? { codexHome: process.env.CODEX_HOME } : {}),
        ...(process.env.XDG_CONFIG_HOME ? { configHome: process.env.XDG_CONFIG_HOME } : {}), ...(process.env.DSH_HOME ? { dshHome: process.env.DSH_HOME } : {}) },
    })
    : method.startsWith('models.') ? models(method, value, signal)
    : extraHost ? extraHost(method, value, signal) : Promise.reject(new NativeServiceError('UNKNOWN_METHOD')),
    spawn(generation) {
      // Native services have the user's OS rights, but do not inherit incidental tokens from the app launch environment.
      const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'XDG_CONFIG_HOME', 'LANG']
        .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
      const child = utilityProcess.fork(join(directory, entry), [`--janusx-native-generation=${generation}`], {
        env, execArgv: ['--max-old-space-size=256'], stdio: 'pipe', serviceName: `JanusX plugin: ${record.manifest.id}`,
      })
      child.stdout?.resume(); child.stderr?.resume()
      return {
        send: packet => child.postMessage(packet),
        listen: listener => { child.on('message', listener); return () => { child.off('message', listener) } },
        exited: listener => { child.on('exit', listener); return () => { child.off('exit', listener) } },
        terminate: () => { child.kill() },
      }
    },
  })
  return service
}
