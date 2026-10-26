// Note: .agents/notes/sessions/workspace-runtime-import.md
import { registeredExternalWorkspaces, projectWorkspace } from './runtime'
import { remoteBackendRequest } from './remote-harness'
import { runtimeResource } from '../../shared/workspace-runtime'
import { agentSessionRegistry, type ImportExternalSessionInput, type AgentSessionRecord } from '../sessions/session-registry'
import { listWorktrees } from '../git/worktrees'
import type { TranscriptDetail } from '../../shared/ipc/session'

export async function scanRemoteSessions(): Promise<{ imported: number; errors: string[] }> {
  let imported = 0
  const errors: string[] = []
  for (const workspace of await registeredExternalWorkspaces()) {
    try {
      const roots = await listWorktrees(workspace.id, projectWorkspace(workspace).path)
      for (const root of roots.filter(item => !item.prunable)) {
        const records = await remoteBackendRequest<ImportExternalSessionInput[]>(root.path, 'session.scan')
        agentSessionRegistry.beginBatch()
        try {
          for (const record of records) {
            agentSessionRegistry.importExternalSession({ ...record, workspaceId: workspace.id,
              cwd: runtimeResource(workspace.id, record.cwd), transcriptPath: runtimeResource(workspace.id, record.transcriptPath) })
            imported++
          }
        } finally { agentSessionRegistry.endBatch() }
      }
    } catch (error) { errors.push(`${workspace.name}: ${String(error)}`) }
  }
  return { imported, errors }
}

export async function readRemoteTranscript(record: AgentSessionRecord): Promise<TranscriptDetail | null> {
  const result = await remoteBackendRequest<TranscriptDetail | null>(record.cwd, 'session.transcript', [`${record.engine}:${record.providerSessionId}`])
  return result ? { ...result, transcriptPath: record.transcriptPath ?? result.transcriptPath } : null
}
