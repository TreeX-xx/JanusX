import type { OfficeHandlerOperations } from '../ipc/office-handlers'
import { buildOfficePromptForAgent, type BuildOfficePromptInput } from './office-skills'
import type { OfficeArtifactIndex } from './office-artifact-index'
import type { OfficeWatchPool } from './office-watch-pool'
import { resolveRuntimeResource, runtimeRequest } from '../workspace/runtime'
import { syncRemoteOfficeFile, retainRemoteOfficePreview, releaseRemoteOfficePreviews } from './remote-office-cache'
import type { OfficeFileEntry } from '../../shared/office'
import { randomUUID } from 'node:crypto'

type ProductionOfficeOperations = Pick<
  OfficeHandlerOperations,
  'listFiles' | 'startPreview' | 'stopPreview' | 'reloadPreview' | 'buildPrompt'
>

interface ProductionOfficeDependencies {
  artifactIndex: Pick<OfficeArtifactIndex, 'list'>
  watchPool: Pick<OfficeWatchPool, 'acquire' | 'release' | 'reload'>
  buildPrompt?: (input: BuildOfficePromptInput) => ReturnType<typeof buildOfficePromptForAgent>
}

export function createProductionOfficeOperations({
  artifactIndex,
  watchPool,
  buildPrompt = buildOfficePromptForAgent,
}: ProductionOfficeDependencies): ProductionOfficeOperations {
  return {
    listFiles: async (workspace) => {
      const remote = await resolveRuntimeResource(workspace.rootPath)
      if (!remote) return artifactIndex.list(workspace.workspaceId)
      const result = await runtimeRequest<{ files: OfficeFileEntry[]; truncated: boolean }>(remote.runtime, 'fs.scan', { root: remote.root, path: remote.relative, mode: 'office' })
      if (result.truncated) throw Object.assign(new Error('Office scan limit reached'), { code: 'SCAN_LIMIT' })
      return result.files
    },
    startPreview: async (file) => {
      const reservation = randomUUID()
      retainRemoteOfficePreview(reservation, file)
      try {
        await syncRemoteOfficeFile(file, true)
        const lease = await watchPool.acquire(file)
        retainRemoteOfficePreview(lease.previewLeaseId, file)
        return lease
      } finally { releaseRemoteOfficePreviews([reservation]) }
    },
    stopPreview: async (file, request) => {
      await watchPool.release(request.previewLeaseId, file.filePath)
      releaseRemoteOfficePreviews([request.previewLeaseId])
    },
    reloadPreview: async (file, request) => {
      await syncRemoteOfficeFile(file, true)
      const lease = await watchPool.reload(request.previewLeaseId, file)
      releaseRemoteOfficePreviews([request.previewLeaseId])
      retainRemoteOfficePreview(lease.previewLeaseId, file)
      return lease
    },
    buildPrompt: (_file, request) => buildPrompt({
      workspaceId: request.workspaceId,
      terminalPreset: request.terminalPreset,
      ...(request.skillId ? { skillId: request.skillId } : {}),
    }),
  }
}
