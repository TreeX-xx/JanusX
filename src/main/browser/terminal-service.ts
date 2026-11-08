// Note: .agents/notes/desktop/browser-control.md
import { app, dialog } from 'electron'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { BrowserTerminalClients } from './terminal-clients'
import { startBrowserTerminalHost } from './terminal-host'
import { browserControl } from './control-service'
import { configService } from '../config/service'
import type { LocalIntegrationService } from '../local-integrations/service'

let clients: BrowserTerminalClients | undefined
let host: ReturnType<typeof startBrowserTerminalHost> | undefined
export function initializeBrowserTerminalClients(service: LocalIntegrationService) {
  if (clients) return
  const directory = join(app.getPath('userData'), 'janusx', 'browser-control')
  const mainDirectory = app.isPackaged ? join(app.getAppPath(), 'out', 'main')
    : process.env.JANUSX_DEV_BUILD_ROOT ? join(process.env.JANUSX_DEV_BUILD_ROOT, 'main')
      : /\.js$/i.test(process.argv[1] ?? '') ? dirname(resolve(process.argv[1])) : join(app.getAppPath(), 'out', 'main')
  const getHost = () => host ??= startBrowserTerminalHost({ file: join(directory, 'connection.json'), broker: browserControl(),
    approve: async (name, input, signal) => {
      signal.throwIfAborted()
      if (!(await configService.getControlSettings()).browser.enabled) return false
      const mode = await configService.getAgentApprovalMode()
      if (mode === 'plan') return false
      if (mode === 'auto-run') return true
      const chinese = (await configService.get()).language !== 'en'
      const result = await dialog.showMessageBox({ type: 'question', title: chinese ? '浏览器控制' : 'Browser control',
        message: `${chinese ? '允许终端 Agent 执行浏览器操作' : 'Allow terminal Agent browser action'} ${name}?`,
        detail: JSON.stringify({ pageId: input.pageId, url: input.url }), buttons: chinese ? ['拒绝', '允许一次'] : ['Deny', 'Allow once'], defaultId: 0, cancelId: 0, signal })
      return !signal.aborted && result.response === 1
    },
  }).catch(error => { host = undefined; throw error })
  clients = new BrowserTerminalClients({ service, directory, home: homedir(), env: process.env, entry: join(mainDirectory, 'browser-mcp.js'),
    executable: process.execPath, piBundle: join(mainDirectory, 'pi-browser.mjs'), disconnect: async client => { await (await getHost()).disconnectClient(client) } })
  // The bridge must be available when an already registered terminal starts.
  void getHost().catch(error => console.error('Browser terminal host unavailable', error instanceof Error ? error.message : String(error)))
  app.once('will-quit', () => { void host?.then(server => server.close()).catch(() => {}) })
}
export function browserTerminalClients() {
  if (!clients) throw new Error('Browser terminal management unavailable')
  return clients
}
export async function disconnectBrowserTerminalClient(client: string, name: string) {
  if (name === 'janusx-browser') await (await host)?.disconnectClient(client)
}
