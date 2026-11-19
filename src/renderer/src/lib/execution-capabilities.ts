// Note: .agents/notes/desktop/platform-runtime-boundaries.md
// Preload's OS describes the local execution target only. Remote targets never borrow it.
import { runtimeCapability, type RuntimeFeature } from '../../../shared/runtime/capabilities'
import { parseRuntimeResource } from '../../../shared/workspace-runtime'
import { createShellProfileSeed } from '../../../shared/shellProfiles'

export function localExecutionPlatform() {
  const platform = window.electron?.platform
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : null
}
export function executionCapability(feature: RuntimeFeature, engine: string, cwd: string) {
  return runtimeCapability(feature, engine, parseRuntimeResource(cwd)
    ? { kind: 'ssh', platform: null } : { kind: 'local', platform: localExecutionPlatform() })
}
export function localShellSeed() {
  // Presentation seed only; main resolves and validates the actual shell before spawn.
  const platform = localExecutionPlatform()
  return platform ? createShellProfileSeed(platform) : { id: 'shell-unavailable', name: 'Shell', command: '', visible: true, isDefault: true }
}
