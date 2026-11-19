// Compatibility entry; new consumers use platform/cli-launch.
// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { resolveCliExecutable } from '../platform/cli-launch'
import type { RuntimeContext } from '../platform/runtime-context'
export { claudeSpawnResult, resolveClaudeBinary, selectWindowsSpawnPath, formatClaudeNativeExeError, ClaudeNativeBinaryError } from '../platform/windows-command'
export type { WindowsSpawnDeps, ClaudeBinaryResolution } from '../platform/windows-command'
export async function resolveCLIPath(command: string, context?: RuntimeContext): Promise<string | null> { return resolveCliExecutable(command, context) }
/** Resolution is fresh, including misses; retained for existing installer callers. */
export function clearCache(): void {}
