// Note: .agents/notes/desktop/platform-runtime-boundaries.md
// Standalone Node composition, with no Electron environment or diagnostics import.
import { stopProcessTree } from './owned-tree'
import { createProcessHost, requireProcessSuccess, type ProcessOptions } from './core'
const host = createProcessHost({ stop: stopProcessTree })
export const spawnProcess = host.spawn
export const runProcess = host.run
export const stopOwnedProcess = (child: Parameters<typeof stopProcessTree>[0]) => stopProcessTree(child, { processGroup: true })
export async function runChecked(program: string, args: readonly string[] = [], options: ProcessOptions = {}) {
  return requireProcessSuccess(await host.run(program, args, options))
}
