// Note: .agents/notes/planning/blueprint-official-plugin.md; graph identity belongs to this plugin.
import { WorkspaceNotesService } from '@janusx/note-tools'
import { projectGraphId } from './note-to-blueprint'
export class WorkspaceBlueprintService extends WorkspaceNotesService {
  override async status(cwd: string) {
    const status = await super.status(cwd)
    return status.projectId ? { ...status, projectId: projectGraphId(status.projectId, status.root) } : status
  }
}
