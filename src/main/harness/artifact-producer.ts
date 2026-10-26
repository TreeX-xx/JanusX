// Note: Janus extends the shared agentX runtime — see .agents/notes/blueprint/agentx-harness-inheritance.md
export { createNoteInput, createNoteOp, setSection, mergeNoteEdit, archiveNoteOp, type ProducedOp, type NoteEdit, type NoteKind } from '@janus-agent/harness-core'
export { applyNodePatch, checkWritablePatch, mapStatusToLifecycle, nodeTypeToKind, type NodeFieldPatch } from '../../../plugins/blueprint/src/main/notes/note-to-blueprint'
