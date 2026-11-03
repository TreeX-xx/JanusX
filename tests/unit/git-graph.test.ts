import { describe, expect, it } from 'vitest'
import { layoutCommitGraph } from '../../src/renderer/src/components/git/graph'
import type { GitHistoryCommit } from '../../src/shared/ipc/git'

const commit = (hash: string, parents: string[]): GitHistoryCommit => ({ hash, parents, shortHash: hash, refs: [], message: hash, author: '', date: '' })
describe('Git graph lanes', () => {
  it('draws a merge and converges both parents at their shared ancestor', () => {
    const graph = layoutCommitGraph([commit('merge', ['main', 'topic']), commit('topic', ['root']), commit('main', ['root']), commit('root', [])])
    expect(graph.lanes).toBe(2)
    expect(graph.rows.map(row => row.lane)).toEqual([0, 1, 0, 1])
    expect(graph.rows[0].segments.filter(edge => edge.start === 'node').map(edge => edge.to)).toEqual([0, 1])
    expect(graph.rows[2].segments).toContainEqual(expect.objectContaining({ from: 0, to: 1, start: 'node', end: 'bottom' }))
    expect(graph.rows[3].segments.filter(edge => edge.start === 'node')).toEqual([])
  })
  it('keeps existing row geometry stable when an older page is appended', () => {
    const page = [commit('merge', ['left', 'right']), commit('left', ['base'])]
    const next = [...page, commit('right', ['base']), commit('base', [])]
    expect(layoutCommitGraph(next).rows.slice(0, 2)).toEqual(layoutCommitGraph(page).rows)
    expect(layoutCommitGraph(page).rows[1].segments.some(edge => edge.end === 'bottom')).toBe(true)
  })
  it('does not connect unrelated roots and supports more than two merge parents', () => {
    expect(layoutCommitGraph([commit('a', []), commit('b', [])]).rows.every(row => row.segments.length === 0)).toBe(true)
    const graph = layoutCommitGraph([commit('octopus', ['a', 'b', 'c']), commit('a', []), commit('b', []), commit('c', [])])
    expect(graph.lanes).toBe(3)
    expect(graph.rows[0].segments).toHaveLength(3)
  })
})
