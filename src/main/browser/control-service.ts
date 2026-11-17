import { app } from 'electron'
import { join } from 'node:path'
import { runProcess } from '../platform/process-host'
import { configService } from '../config/service'
import { BrowserControlBroker } from './control-broker'
import { createDevtoolsClient, DEVTOOLS_VERSION, checkBrowserEndpoint } from './devtools-runtime'
import type { BrowserSurfaceManager } from './surface-manager'
import type { ControlStatus } from '../../shared/ipc/control'

let broker: BrowserControlBroker | undefined
export function initializeBrowserControl(surfaces: BrowserSurfaceManager): void {
  if (broker) return
  const directory = join(app.getPath('userData'), 'janusx', 'browser-control', 'artifacts')
  broker = new BrowserControlBroker({ surfaces, directory, settings: () => configService.getControlSettings(),
    connect: (id, root) => createDevtoolsClient(id, directory, root) })
}
export function browserControl(): BrowserControlBroker {
  if (!broker) throw new Error('Browser host unavailable')
  return broker
}
export async function endBrowserTurn(runId: string): Promise<void> { await broker?.endTurn(runId) }
export async function stopBrowserControl(): Promise<void> { await broker?.stop() }
export async function controlStatus(): Promise<ControlStatus> {
  const settings = await configService.getControlSettings()
  let error: string | undefined
  try { await checkBrowserEndpoint(); await browserControl().catalog() } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  return { browser: { enabled: settings.browser.enabled, provider: 'chrome-devtools-mcp', version: DEVTOOLS_VERSION,
    state: error ? 'unavailable' : 'ready', ...(error ? { error } : {}), active: broker?.activeControl ?? false },
    computer: { provider: 'cua-driver', configured: !!settings.computer.executable, connected: false } }
}
export async function checkComputerRuntime(): Promise<{ available: boolean; version?: string; error?: string }> {
  const settings = await configService.getControlSettings()
  const result = await runProcess(settings.computer.executable || 'cua-driver', ['--version'], { timeoutMs: 5000, maxOutputBytes: 4096 })
  const output = `${result.stdout}${result.stderr}`.trim()
  return result.status === 'exited' && result.exitCode === 0 && /cua[-\s_]*driver/i.test(output)
    ? { available: true, version: output }
    : { available: false, error: result.status === 'exited' ? output || `Cua Driver unavailable (exit ${result.exitCode})` : `Driver detection ${result.status}` }
}
