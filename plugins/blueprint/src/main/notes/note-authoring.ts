// Note: v2 adoption uses shared readers and writers — see .agents/notes/blueprint/workflowx-v2-adoption.md
import { posix } from 'node:path'
import { readHarnessIdentity, type NoteService } from '@janus-agent/harness-node'

export interface NoteAuthoringContext { schema: 'harness-note/1' | 'harness-note/2'; module?: string; directory?: string }

/** Resolve the selected checkout and nearest declared owner before constructing a proposal. */
export async function noteAuthoringContext(service: Pick<NoteService, 'readSnapshot'>, root: string, parentUri?: string, expectedRepoId?: string): Promise<NoteAuthoringContext> {
  const identity = await readHarnessIdentity(root)
  if (expectedRepoId && identity.repoId !== expectedRepoId) throw new Error('SCHEMA_INVALID: selected checkout does not match the requested repository')
  if (identity.diagnostics.length) throw identity.diagnostics[0]
  if (JSON.parse(identity.profileKey!).version !== '2.0.0') return { schema: 'harness-note/1' }
  const snapshot = await service.readSnapshot(root)
  const parent = parentUri ? snapshot.entries.find(entry => entry.uri === parentUri) : undefined
  if (parentUri && !parent?.doc) throw new Error('UNRESOLVED_REFERENCE: selected Note is unavailable')
  const ownerUri = parent?.doc?.kind === 'module' ? parent.uri : parent?.doc?.module
  const owner = ownerUri ? snapshot.entries.find(entry => entry.uri === ownerUri) : snapshot.entries.find(entry => entry.relPath === '.agents/notes/module.md')
  if (owner?.doc?.kind !== 'module' || !owner.uri) throw new Error('NOT_READY: declare the owning module before creating documents')
  return { schema: 'harness-note/2', module: owner.uri, directory: posix.dirname(owner.relPath).replace(/^\.agents\/notes\/?/, '') }
}

/** Same stable title spelling as the shared transaction writer; collisions require an explicit name. */
export function maintainedNotePath(directory: string, title: string): string {
  const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'note'
  return posix.join(directory, slug + '.md')
}
