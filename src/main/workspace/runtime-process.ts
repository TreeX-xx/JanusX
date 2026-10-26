// Note: .agents/notes/sessions/workspace-runtime-import.md
import { randomUUID } from 'node:crypto'
import { resolveRuntimeResource, runtimeRequest } from './runtime'

export async function runWorkspaceProcess(cwd: string, argv: string[], options: { timeout: number; maxBytes: number; truncate?: boolean; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
  const resource = await resolveRuntimeResource(cwd)
  if (!resource) throw new Error('A remote workspace is required')
  if (options.signal?.aborted) throw new Error('Process cancelled')
  const operationId = randomUUID()
  const abort = () => { void runtimeRequest(resource.runtime, 'process.cancel', { operationId }).catch(() => undefined) }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await runtimeRequest<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }>(resource.runtime, 'process.run', {
      root: resource.root, path: resource.relative, argv, operationId,
      timeout: options.timeout / 1000, maxBytes: options.maxBytes, truncate: options.truncate,
      env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' },
    })
    if (options.signal?.aborted) throw new Error('Process cancelled')
    return result
  } finally { options.signal?.removeEventListener('abort', abort) }
}
