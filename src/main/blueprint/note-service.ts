// Note: .agents/notes/planning/blueprint-official-plugin.md — temporary adapter for legacy desktop blueprint consumers.
import { harnessNoteService } from '../harness/service'
import { BlueprintNoteProjection } from '../../../plugins/blueprint/src/main/notes/projection'
import type { BlueprintNotes } from '../../../plugins/blueprint/src/main/notes/service'

export type { ProjectView } from '../../../plugins/blueprint/src/main/notes/projection'
export const blueprintNoteView = new BlueprintNoteProjection(harnessNoteService)

// Keep transactions, listeners and indexes on the existing shared instance.
export const legacyBlueprintNotes: BlueprintNotes = {
  projectView: root => blueprintNoteView.projectView(root),
  resolveRoot: root => harnessNoteService.resolveRoot(root),
  readSnapshot: root => harnessNoteService.readSnapshot(root),
  readNote: (root, uri) => harnessNoteService.readNote(root, uri),
  applyBundleChangeSet: (root, changeSet, reason) => harnessNoteService.applyBundleChangeSet(root, changeSet, reason),
}
