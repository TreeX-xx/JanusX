// Transitional desktop adapter; business logic is owned by the official plugin.
import { WorkspaceBlueprintService as PluginWorkspaceService } from '../../../plugins/blueprint/src/main/notes/workspace-blueprint'
import { harnessNoteService } from './service'
export class WorkspaceBlueprintService extends PluginWorkspaceService {
  constructor(notes: ConstructorParameters<typeof PluginWorkspaceService>[0] = harnessNoteService) { super(notes) }
}
export const workspaceBlueprintService = new WorkspaceBlueprintService()
