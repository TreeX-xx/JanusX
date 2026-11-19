// Note: .agents/notes/agent/superagent-plugin-migration.md — a native stop receipt includes process-group exit.
import { runChecked } from '../../platform/process-host/node'
import { setTimeout as delay } from 'node:timers/promises'

/** Observe identity only. A persisted PID is never authority to signal a process. */
export async function darwinGroupLeader(pid: number, parent?: number) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid Worker process identity')
  const { stdout } = await runChecked('/bin/ps', ['-p', String(pid), '-o', 'ppid=,pgid=,lstart='], { env: { ...process.env, LC_ALL: 'C' } })
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(stdout)
  const started = match && Date.parse(match[3])
  if (!match || Number(match[2]) !== pid || (parent !== undefined && Number(match[1]) !== parent) || !Number.isSafeInteger(started))
    throw new Error('Worker does not own a verifiable process group')
  return [{ pid, started: String(started) }]
}

export async function confirmDarwinGroupExit(pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(-pid, 0) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH') return
      if (code !== 'EPERM') throw error
      // Darwin can deny a signal probe while sandboxed descendants exit. Inspect group membership independently.
      const { stdout } = await runChecked('/bin/ps', ['-A', '-o', 'pgid='], { maxOutputBytes: 4 * 1024 * 1024 })
      if (!stdout.split(/\s+/).includes(String(pid))) return
    }
    await delay(50)
  }
  throw new Error('Worker process group exit was not confirmed')
}
