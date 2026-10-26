/**
 * @file Note boundary types (V2 readonly refactor)
 * @description Structural note vocabulary owned by `src/main/notes/`. Deliberately
 *  free of harness-core/harness-node imports (not even type-only): the adapter
 *  below must stay usable from a fixture upgrade that touches only
 *  `note-to-blueprint.ts` plus golden snapshots. `note-provider.ts` converts the
 *  parsed representation into these shapes at the boundary.
 *  See .agents/notes/blueprint/navigation/blueprint-note-graph-readonly.md
 */

/** Frontmatter schema claimed by harness notes. */
export const NOTE_SCHEMA_VERSION = 'harness-note/2'

/** NoteAdapter version surfaced as `projectView.adapterVersion`. */
export const ADAPTER_VERSION = 'v2'

import type { NoteDoc, NoteReadSnapshot } from '@janus-agent/harness-node'
export type { NoteDoc } from '@janus-agent/harness-node'

export type NoteKind = 'module' | 'note' | 'idea' | 'initiative' | 'requirement' | 'decision' | 'task'

export interface NoteSection {
  name: string
  text: string
}

export interface NoteAc {
  id: string
  text: string
  checked?: boolean
}

export interface NoteRelationRef {
  type: string
  target: string
  criteria?: string[]
  scope?: 'full' | 'partial'
  reason?: string
}

/**
 * Structural note document. `kind`/`lifecycle` stay `string` on purpose:
 * unknown values must flow through and degrade in the adapter (to
 * `issue`/`planning`/`related-to` with prose preserved), never throw.
 */

/** One adapter input: document plus file identity for sha-pinned reads. */
export interface NoteGraphEntry {
  doc: NoteDoc
  relPath: string
  sha256: string
}

/** One workspace projection input: exactly one repo root. */
export interface NoteGraph {
  repoId: string | null
  repoName: string
  entries: NoteGraphEntry[]
  revision: number
  snapshot?: NoteReadSnapshot
}
