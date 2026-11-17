// Note: .agents/notes/desktop/application-shutdown.md
import type { ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { captureAndStopWindowsProcessTree, terminateWindowsProcessTree, type WindowsProcessTree } from '@janus-agent/janus-agent/superagent/native/windows-process-tree'
let logShutdown: (event: string, fields: Record<string, string | number | boolean | undefined>) => void = () => {}
export function configureProcessTreeDiagnostics(log: typeof logShutdown): void { logShutdown = log }

export type OwnedProcess = Pick<ChildProcess, 'pid'> & Partial<Pick<ChildProcess, 'exitCode' | 'signalCode'>>
interface StopOptions { processGroup?: boolean; graceMs?: number }
interface StopRecord { target: OwnedProcess; options: StopOptions; tree?: WindowsProcessTree; flight?: Promise<void> }
const records = new WeakMap<OwnedProcess, StopRecord>()
const pending = new Set<StopRecord>()
const execute = promisify(execFile)
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error }
}
async function waitGone(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (alive(pid)) { if (Date.now() >= until) return false; await pause(25) }
  return true
}

async function stop(record: StopRecord): Promise<void> {
  const { target, options } = record, pid = target.pid
  if (!pid) return
  logShutdown('process-stop', { targetPid: pid, platform: process.platform })
  if (process.platform === 'win32') {
    // Capture while the parent is still available. Termination checks native
    // creation times and handles, including descendants, instead of a bare PID.
    if (!record.tree) {
      if (target.exitCode != null || target.signalCode != null) return
      const result = await captureAndStopWindowsProcessTree(pid)
      record.tree = result.tree
      if (result.active.length || result.failures.length) throw new Error(`Owned process exit unconfirmed: ${result.failures.join('; ')}; active=${result.active.join(',')}`)
    } else await terminateWindowsProcessTree(record.tree)
  } else {
    let signalPid = pid
    if (options.processGroup) {
      // PTY children normally lead a session; verify rather than signalling an
      // inherited group that may also contain the user's unrelated processes.
      const { stdout } = await execute('ps', ['-o', 'pgid=', '-p', String(pid)], { timeout: 1000 }).catch(error => {
        if (!alive(pid)) return { stdout: '' }
        throw error
      })
      if (Number(stdout.trim()) === pid) signalPid = -pid
    }
    if (alive(signalPid)) {
      try { process.kill(signalPid, 'SIGTERM') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      if (!await waitGone(signalPid, options.graceMs ?? 1000)) {
        try { process.kill(signalPid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        if (!await waitGone(signalPid, 2000)) throw new Error(`Owned process exit unconfirmed: ${pid}`)
      }
    }
  }
  logShutdown('process-stopped', { targetPid: pid, treeSize: record.tree?.length })
}

export function stopProcessTree(target: OwnedProcess, options: StopOptions = {}): Promise<void> {
  let record = records.get(target)
  if (!record) { record = { target, options }; records.set(target, record) }
  if (record.flight) return record.flight
  const current = record
  pending.add(current)
  current.flight = stop(current).then(() => { pending.delete(current) }).catch(error => {
    current.flight = undefined
    logShutdown('process-unconfirmed', { targetPid: target.pid, errorType: error instanceof Error ? error.name : 'UnknownError' })
    throw error
  })
  return current.flight
}

/** Retry failed owned identities; an in-flight native stop already uses force. */
export async function retryPendingProcessStops(): Promise<void> {
  const results = await Promise.allSettled([...pending].map(record => stopProcessTree(record.target, record.options)))
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned processes remain unconfirmed')
}
