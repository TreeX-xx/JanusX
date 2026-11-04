import { create } from 'zustand'
import type { ExternalCliDetectResult, ExternalCliToolId } from '../../../shared/ipc/external-cli'

type Probe = ExternalCliDetectResult & { checkedAt: number; error?: string }
export const useCliReadiness = create<{ probes: Record<string, Probe> }>(() => ({ probes: {} }))
const pending = new Map<string, Promise<Probe>>()
export function probeCli(toolId: ExternalCliToolId, workspaceId?: string, force = false): Promise<Probe> {
  const key = `${workspaceId ?? 'local'}:${toolId}`
  const active = pending.get(key)
  if (active) return force ? active.then(() => probeCli(toolId, workspaceId, true)) : active
  const cached = useCliReadiness.getState().probes[key]
  if (!force && cached && Date.now() - cached.checkedAt < 30_000) return Promise.resolve(cached)
  const promise = (async (): Promise<Probe> => {
    try {
      if (workspaceId && !window.electron.workspaceRuntime) throw new Error('Workspace runtime is unavailable')
      const result = workspaceId
        ? await window.electron.workspaceRuntime!.detectCli(workspaceId, toolId).then(result => ({ toolId, installed: result.installed, runnable: result.installed }))
        : await window.electron.externalCli.detect(toolId)
      return { ...result, checkedAt: Date.now() }
    } catch (error) {
      return { toolId, installed: false, runnable: false, checkedAt: Date.now(), error: String(error) }
    }
  })().then(result => {
    useCliReadiness.setState(state => ({ probes: { ...state.probes, [key]: result } }))
    return result
  }).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

type Setup = { toolId: ExternalCliToolId; busy: boolean; checking?: boolean; error?: string; broken?: boolean }
export const useLocalCliSetup = create<{ request: Setup | null }>(() => ({ request: null }))
let finish: ((ready: boolean) => void) | undefined
export function closeLocalCliSetup(ready = false): void {
  const resolve = finish
  finish = undefined
  useLocalCliSetup.setState({ request: null })
  resolve?.(ready)
}

export async function ensureLocalCli(toolId: ExternalCliToolId): Promise<boolean> {
  if (!window.electron?.externalCli?.detect) return true
  // A second click must not replace the first pending launch intent.
  if (useLocalCliSetup.getState().request) return false
  const cached = useCliReadiness.getState().probes[`local:${toolId}`]
  if (cached?.runnable && Date.now() - cached.checkedAt < 30_000) return true
  const request: Setup = { toolId, busy: false, checking: true }
  useLocalCliSetup.setState({ request })
  const ready = new Promise<boolean>(resolve => { finish = resolve })
  const result = await probeCli(toolId)
  if (useLocalCliSetup.getState().request !== request) return ready
  if (result.runnable) closeLocalCliSetup(true)
  else useLocalCliSetup.setState({ request: { ...request, checking: false, broken: result.installed, error: result.error ?? (result.installed ? result.hint : undefined) } })
  return ready
}

export async function prepareLocalCli(install: boolean): Promise<void> {
  const current = useLocalCliSetup.getState().request
  if (!current || current.busy || current.checking) return
  const request = { ...current, busy: true, error: undefined }
  useLocalCliSetup.setState({ request })
  try {
    if (install) {
      const result = await window.electron.externalCli.install(request.toolId)
      if (!result.success) throw new Error(result.error || 'Installation failed')
    }
    const probe = await probeCli(request.toolId, undefined, true)
    if (useLocalCliSetup.getState().request !== request) return
    if (probe.runnable) closeLocalCliSetup(true)
    else useLocalCliSetup.setState({ request: { ...request, busy: false, broken: probe.installed,
      error: probe.error ?? (probe.installed ? probe.hint : undefined) } })
  } catch (error) {
    if (useLocalCliSetup.getState().request === request) useLocalCliSetup.setState({ request: { ...request, busy: false, error: error instanceof Error ? error.message : String(error) } })
  }
}
