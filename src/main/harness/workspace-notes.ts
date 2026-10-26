// Note: .agents/notes/planning/blueprint-official-plugin.md; initialization uses the shared Note engine.
import { WorkspaceNotesService } from '@janusx/note-tools'
import { harnessNoteService } from './service'
export const workspaceNotesService = new WorkspaceNotesService(harnessNoteService)
