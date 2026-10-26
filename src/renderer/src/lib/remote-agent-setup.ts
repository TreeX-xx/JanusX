import { useWorkspaceStore } from '@/stores/workspace'
import type { Terminal } from '@/types'

const waiting = new Map<string, (ready: boolean) => void>()

export function cancelRemoteAgentSetup(id: string): void {
  waiting.get(id)?.(false)
}

export async function ensureRemoteAgent(terminal: Terminal): Promise<boolean> {
  const api = window.electron.workspaceRuntime
  if (!api) throw new Error('Remote Agent support is unavailable. Restart JanusX.')
  const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === terminal.workspaceId)
  const runtime = workspace?.runtime
  let environment = runtime?.kind === 'wsl' ? `WSL · ${runtime.distro}` : runtime?.kind === 'ssh' ? `SSH · ${runtime.host}` : 'Linux'
  let error: string | undefined
  try {
    const probe = await api.detectCli(terminal.workspaceId, terminal.preset)
    if (!useWorkspaceStore.getState().terminals.some(item => item.id === terminal.id)) return false
    if (probe.installed) return true
    environment += ` · ${probe.environment}`
  } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
  if (!useWorkspaceStore.getState().terminals.some(item => item.id === terminal.id)) return false
  return new Promise(resolve => {
    const unsubscribe = useWorkspaceStore.subscribe(state => {
      if (!state.terminals.some(item => item.id === terminal.id)) waiting.get(terminal.id)?.(false)
    })
    waiting.set(terminal.id, ready => {
      waiting.delete(terminal.id)
      unsubscribe()
      useWorkspaceStore.getState().updateTerminal(terminal.id, { agentSetup: undefined })
      resolve(ready)
    })
    useWorkspaceStore.getState().updateTerminal(terminal.id, { agentSetup: { environment, busy: false, error } })
  })
}

export async function installAndOpenRemoteAgent(id: string): Promise<void> {
  const terminal = useWorkspaceStore.getState().terminals.find(item => item.id === id)
  if (!terminal?.agentSetup || terminal.agentSetup.busy || !waiting.has(id)) return
  const setup = terminal.agentSetup
  const update = (patch: Partial<NonNullable<Terminal['agentSetup']>>) => {
    const current = useWorkspaceStore.getState().terminals.find(item => item.id === id)?.agentSetup
    if (waiting.has(id)) useWorkspaceStore.getState().updateTerminal(id, { agentSetup: { ...setup, ...current, busy: true, ...patch } })
  }
  update({ error: undefined, log: undefined })
  try {
    const api = window.electron.workspaceRuntime!
    let job = await api.installCli(terminal.workspaceId, terminal.preset)
    while (waiting.has(id) && job.state === 'running') {
      update({ log: job.log })
      await new Promise(resolve => setTimeout(resolve, 1000))
      if (!waiting.has(id)) return
      try {
        job = await api.cliInstallStatus(terminal.workspaceId, terminal.preset)
      } catch (reason) {
        throw new Error('Unable to read installation status. The remote installer may still be running; retry to check again. ' + (reason instanceof Error ? reason.message : String(reason)))
      }
    }
    if (!waiting.has(id)) return
    update({ log: job.log })
    if (job.state !== 'complete') throw new Error(job.error || job.log || 'Installation did not complete')
    const probe = await api.detectCli(terminal.workspaceId, terminal.preset)
    if (!probe.installed) throw new Error('CLI was not found after installation')
    waiting.get(id)?.(true)
  } catch (reason) {
    update({ busy: false, error: reason instanceof Error ? reason.message : String(reason) })
  }
}
