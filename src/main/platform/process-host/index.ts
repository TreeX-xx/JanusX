// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { stopProcessTree } from '../../shutdown/process-tree'
import { createProcessHost, requireProcessSuccess, type ProcessOptions } from './core'
import { localRuntimeContext } from '../runtime-context'
import type { SpawnOptions } from 'node:child_process'

const localHost = createProcessHost({ stop: stopProcessTree })
export function spawnProcess(program: string, args: readonly string[] = [], options: SpawnOptions = {}) {
  return localHost.spawn(program, args, { env: localRuntimeContext().env, ...options })
}
export function runProcess(program: string, args: readonly string[] = [], options: ProcessOptions = {}) {
  return localHost.run(program, args, { env: localRuntimeContext().env, ...options })
}
export const stopOwnedProcess = (child: Parameters<typeof stopProcessTree>[0]) => stopProcessTree(child, { processGroup: true })
export { spawnShellCommand, requireProcessSuccess } from './core'
export type { ProcessOutcome, ProcessOptions } from './core'
export async function runChecked(program: string, args: readonly string[] = [], options: ProcessOptions = {}) {
  return requireProcessSuccess(await runProcess(program, args, options))
}
