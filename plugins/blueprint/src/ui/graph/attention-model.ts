import type { NoteStructureIssue } from '../../shared/blueprint-review'
import type { Blueprint } from '../../shared/janus/types'
import type { AutomaticReviewTarget, BlueprintReviewView, ReviewActivity } from '../../shared/ipc/blueprint-review'
import type { BlueprintNoteDestination, NoteUpdate } from '../../shared/blueprint-attention'
const sameCheckoutPath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
import { nodeNoteSnapshot } from './composition-view'

export function attentionRoots(blueprint: Blueprint | null, workspacePath?: string): string[] {
  const root = workspacePath || blueprint?.noteSnapshot?.coverage.checkoutRoot
  return root ? [root] : []
}
export function attentionNode(blueprint: Blueprint, root: string, noteId: string): string | undefined {
  return blueprint.nodeIds.find(id => blueprint.nodes[id]?.sourceUri?.endsWith('/' + noteId)
    && sameCheckoutPath(nodeNoteSnapshot(blueprint, id)?.coverage.checkoutRoot ?? '', root))
}
export interface AttentionRow {
  key: string; root: string; noteId: string; title: string; module: string; path: string
  context: BlueprintReviewView['context']
  update?: NoteUpdate
  item?: BlueprintReviewView['items'][number]
  target?: AutomaticReviewTarget
  activity?: ReviewActivity
  available: boolean
  structureIssues?: NoteStructureIssue[]
  fileOnly?: boolean
}
export type AttentionMode = 'updates' | 'suggestions' | 'automatic'
export function attentionRows(blueprint: Blueprint | null, roots: string[], views: Record<string, BlueprintReviewView>): AttentionRow[] {
  return roots.flatMap(root => {
    const view = views[root]
    if (!view) return []
    const ids = new Set([...view.items.map(item => item.noteId), ...view.activities.map(activity => activity.noteId),
      ...(view.structure?.issues.flatMap(issue => issue.noteId ? [issue.noteId] : []) ?? []), ...(view.updates?.entries.map(entry => entry.noteId) ?? []), ...(view.automatic?.targets?.map(target => target.noteId) ?? [])])
    const noteRows: AttentionRow[] = [...ids].map(noteId => {
      const nodeId = blueprint && attentionNode(blueprint, root, noteId)
      const node = nodeId && blueprint?.nodes[nodeId]
      const snapshot = nodeId && blueprint ? nodeNoteSnapshot(blueprint, nodeId) : undefined
      const item = view.items.find(item => item.noteId === noteId)
      const update = view.updates?.entries.find(entry => entry.noteId === noteId)
      const target = view.automatic?.targets?.find(target => target.noteId === noteId)
      const activity = view.activities.find(activity => activity.noteId === noteId)
      const owner = node && (node.note?.module ?? node.note?.parent)
      const module = snapshot?.entries.find(entry => owner?.endsWith('/' + entry.doc?.id))?.doc?.title ?? ''
      const structureIssues = view.structure?.issues.filter(issue => issue.noteId === noteId)
      const path = structureIssues?.[0]?.path ?? update?.path ?? item?.source?.path ?? target?.path ?? ''
      const structureFile = Boolean(structureIssues?.length) && path.startsWith('.agents/notes/') && !path.split('/').includes('..')
      const fileOnly = structureFile && (!nodeId || update?.available === false || item?.availability === 'deleted' || item?.availability === 'unavailable')
      return { key: `${root}:${view.context.branch}:${noteId}`, context: view.context, root, noteId, title: node ? node.title : target?.title || path || noteId,
        module, path, item, update, target, activity, structureIssues, fileOnly, available: fileOnly || (Boolean(nodeId) && update?.available !== false && item?.availability !== 'deleted' && item?.availability !== 'unavailable') }
    })
    const paths = [...new Set(view.structure?.issues.filter(issue => !issue.noteId && issue.path.startsWith('.agents/notes/')).map(issue => issue.path))]
    return [...noteRows, ...paths.map((path): AttentionRow => ({ key: root + ':' + view.context.branch + ':file:' + path, context: view.context, root,
      noteId: 'file:' + path, title: path, module: '', path, structureIssues: view.structure?.issues.filter(issue => issue.path === path),
      available: true, fileOnly: true }))]
  }).sort((a, b) => (b.update?.observedAt ?? '').localeCompare(a.update?.observedAt ?? '') || a.title.localeCompare(b.title))
}
export function matchesAttention(row: AttentionRow, mode: AttentionMode): boolean {
  return mode === 'updates' ? Boolean(row.update?.unread) : mode === 'suggestions' ? Boolean(row.item?.report?.findings.length || row.structureIssues?.length)
    : Boolean(row.item?.awaitingReview || row.structureIssues?.length || row.target && (row.target.retrying || ['reviewed', 'incomplete', 'failed'].includes(row.target.state)))
}
export function attentionReviewState(row: AttentionRow): AutomaticReviewTarget['state'] {
  if (row.structureIssues?.length) return 'failed'
  if (row.activity) return 'reviewing'
  if (row.item?.awaitingReview) return row.item.error ? 'failed' : 'incomplete'
  if (row.target) return row.target.state
  if (row.item?.error) return 'failed'
  if (row.item?.report?.coverage === 'insufficient') return 'incomplete'
  return 'reviewed'
}
export type AutomaticAttentionGroup = 'completed' | 'needsRetry'
export function automaticAttentionGroup(row: AttentionRow): AutomaticAttentionGroup {
  return row.item?.awaitingReview || row.structureIssues?.length || row.target?.retrying || row.target?.state === 'failed' || row.target?.state === 'incomplete' ? 'needsRetry' : 'completed'
}
export function rowDestination(row: AttentionRow, mode: AttentionMode): BlueprintNoteDestination {
  const state = attentionReviewState(row)
  const intent = mode === 'updates' ? 'body' : mode === 'suggestions' ? 'suggestions'
    : state === 'failed' ? 'failure' : state === 'incomplete' ? 'coverage'
      : state === 'pending' || state === 'reviewing' ? 'activity' : 'suggestions'
  return { context: row.context, root: row.root, noteId: row.noteId, intent, hash: mode === 'updates' ? row.update?.hash : undefined,
    reportRevision: mode === 'automatic' ? row.target?.reportRevision ?? row.item?.reportRevision : row.item?.reportRevision }
}
