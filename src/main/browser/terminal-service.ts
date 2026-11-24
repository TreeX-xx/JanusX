// Note: .agents/notes/desktop/browser-control.md and .agents/notes/desktop/browser-computer-use.md
import { app, dialog } from 'electron'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { BrowserTerminalClients } from './terminal-clients'
import { startBrowserTerminalHost, type TerminalTools } from './terminal-host'
import { browserControl } from './control-service'
import { configService } from '../config/service'
import { appShutdown } from '../shutdown/AppShutdown'
import { assertApplicationRunning } from '../shutdown/quit-state'
import type { LocalIntegrationService } from '../local-integrations/service'
import type { ControlKind } from '../../shared/ipc/control'
import { beginComputerTurn, callComputer, computerTurnSignal, endComputerTurn, resetComputer } from '../computer/control'
import { computerTools, computerReadTools } from '../computer/tools'

type Host = ReturnType<typeof startBrowserTerminalHost>
const clients = new Map<ControlKind, BrowserTerminalClients>()
const hosts = new Map<ControlKind, Host>()
const computerAdapter: TerminalTools = {
  open: async (id, client) => {
    const registered = (await browserTerminalClients('computer').status()).some(row => row.id === client && row.state === 'configured')
    if (!registered) throw new Error('Register this computer MCP client in Settings')
    await beginComputerTurn(id, client)
    return computerTools.map(d => d.tool)
  },
  release: async id => endComputerTurn(id),
  signal: computerTurnSignal,
  call: callComputer,
  names: new Set(computerTools.map(d => d.tool.name)),
  readOnly: computerReadTools,
}

export function initializeBrowserTerminalClients(service: LocalIntegrationService) {
  assertApplicationRunning()
  if (clients.size) return
  const mainDirectory = app.isPackaged ? join(app.getAppPath(), 'out', 'main')
    : process.env.JANUSX_DEV_BUILD_ROOT ? join(process.env.JANUSX_DEV_BUILD_ROOT, 'main')
      : /\.js$/i.test(process.argv[1] ?? '') ? dirname(resolve(process.argv[1])) : join(app.getAppPath(), 'out', 'main')
  for (const kind of ['browser', 'computer'] as const) {
    const directory = join(app.getPath('userData'), 'janusx', kind + '-control')
    const getHost = () => {
      const existing = hosts.get(kind)
      if (existing) return existing
      const host = startBrowserTerminalHost({ file: join(directory, 'connection.json'), broker: kind === 'browser' ? browserControl() : computerAdapter,
        approve: async (name, input, signal) => {
          signal.throwIfAborted()
          if (!(await configService.getControlSettings())[kind].enabled) return false
          const mode = await configService.getAgentApprovalMode()
          if (mode === 'plan') return false
          if (mode === 'auto-run') return true
          const zh = (await configService.get()).language !== 'en'
          const title = kind === 'computer' ? (zh ? '电脑控制' : 'Computer control') : (zh ? '浏览器控制' : 'Browser control')
          const result = await dialog.showMessageBox({ type: 'question', title,
            message: zh ? `允许终端 Agent 执行${title}操作 ${name}？` : `Allow terminal Agent ${kind} action ${name}?`,
            detail: JSON.stringify(kind === 'computer' ? input : { pageId: input.pageId, url: input.url }).slice(0, 600),
            buttons: zh ? ['拒绝', '允许一次'] : ['Deny', 'Allow once'], defaultId: 0, cancelId: 0, signal })
          return !signal.aborted && result.response === 1
        },
      }).catch(error => { hosts.delete(kind); throw error })
      hosts.set(kind, host)
      return host
    }
    clients.set(kind, new BrowserTerminalClients({ kind, service, directory, home: homedir(), env: process.env, entry: join(mainDirectory, 'browser-mcp.js'),
      executable: process.execPath, piBundle: join(mainDirectory, 'pi-browser.mjs'), disconnect: async client => { await (await getHost()).disconnectClient(client) } }))
    void getHost().catch(error => console.error(`[${kind}] terminal host unavailable`, error))
  }
  appShutdown.configure({ stopBrowserTerminalHost: async () => {
    resetComputer()
    await Promise.all([...hosts.values()].map(async host => (await host).close()))
  } })
}
export function browserTerminalClients(kind: ControlKind = 'browser') {
  const manager = clients.get(kind)
  if (!manager) throw new Error('Terminal management unavailable')
  return manager
}
export async function disconnectBrowserTerminalClient(client: string, name: string) {
  for (const [kind, host] of hosts) {
    if (name === 'janusx-' + kind) await (await host).disconnectClient(client)
  }
}
