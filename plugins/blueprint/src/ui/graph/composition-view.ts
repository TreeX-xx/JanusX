import type { Blueprint } from '../../shared/janus/types'

export function nodeNoteSnapshot(blueprint: Blueprint, nodeId: string) {
  const member = blueprint.composition?.nodes[nodeId]
  return member?.layer === 'evidence'
    ? blueprint.composition?.checkouts.find(row => row.repoId === member.repoId && row.checkoutId === member.checkoutId)?.snapshot
    : blueprint.noteSnapshot
}

/** Full URI plus source checkout; ambiguous external worktrees require selection. */
export function resolveCompositionNote(blueprint: Blueprint, currentId: string, uri: string): string | undefined {
  const current = blueprint.composition?.nodes[currentId]
  const matches = blueprint.nodeIds.filter(id => blueprint.nodes[id]?.sourceUri === uri)
  const local = matches.filter(id => blueprint.composition?.nodes[id]?.path === current?.path)
  if (local.length === 1) return local[0]
  if (local.length > 1) return undefined
  const selected = matches.filter(id => {
    const member = blueprint.composition?.nodes[id]
    return blueprint.composition?.checkouts.some(row => row.repoId === member?.repoId && row.checkoutId === member?.checkoutId && row.selected && row.status !== 'unbound')
  })
  return selected.length === 1 ? selected[0] : selected.length === 0 && matches.length === 1 ? matches[0] : undefined
}
