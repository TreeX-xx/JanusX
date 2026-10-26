/**
 * @file Deprecated shim over NoteAdapter v1 (V2 readonly refactor)
 * @description All mapping tables moved to `src/main/notes/note-to-blueprint.ts`.
 *  New code must import from `../notes/note-to-blueprint` directly; this module
 *  only keeps existing importers compiling.
 *  See .agents/notes/blueprint/navigation/blueprint-note-graph-readonly.md
 * @deprecated Use NoteAdapter v1 (`src/main/notes/note-to-blueprint.ts`).
 */
export {
  kindToNodeType,
  lifecycleToStatus,
  projectGraph,
  projectGraphId,
  projectNode,
  projectRelations,
} from '../../../plugins/blueprint/src/main/notes/note-to-blueprint'
export type { NoteDoc, NoteGraph, NoteGraphEntry, NoteKind } from '../../../plugins/blueprint/src/main/notes/note-to-blueprint'

/** @deprecated Use `NoteGraphEntry` from NoteAdapter v1. */
export type { NoteGraphEntry as ProjectedEntry } from '../../../plugins/blueprint/src/main/notes/note-to-blueprint'

/** @deprecated Use `NoteGraph` from NoteAdapter v1. */
export type { NoteGraph as ProjectGraphInput } from '../../../plugins/blueprint/src/main/notes/note-to-blueprint'
