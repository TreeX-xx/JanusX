import type { GitHistoryCommit } from '../../../../shared/ipc/git'

export interface GraphSegment { from: number; to: number; start: 'top' | 'node'; end: 'node' | 'bottom'; color: number }
export interface GraphRow { lane: number; color: number; segments: GraphSegment[] }

// Note: .agents/notes/workbench/git-workbench.md — each segment terminates at
// an actual parent, including parents beyond the currently loaded page.
export function layoutCommitGraph(commits: GitHistoryCommit[]): { rows: GraphRow[]; lanes: number } {
  const lanes: Array<{ hash: string; color: number } | null> = []
  let nextColor = 1
  let width = 1
  const rows = commits.map(commit => {
    let lane = lanes.findIndex(item => item?.hash === commit.hash)
    const incoming = lane !== -1
    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) lane = lanes.length
      lanes[lane] = { hash: commit.hash, color: commit.refs.some(ref => ref.kind === 'head') ? 0 : nextColor++ }
    }
    const color = lanes[lane]!.color
    const segments: GraphSegment[] = []
    lanes.forEach((item, index) => {
      if (!item || (index === lane && !incoming)) return
      segments.push({ from: index, to: index, start: 'top', end: index === lane ? 'node' : 'bottom', color: item.color })
    })
    lanes[lane] = null
    for (const [index, parent] of [...new Set(commit.parents)].entries()) {
      let target = lanes.findIndex(item => item?.hash === parent)
      if (target === -1) {
        target = index === 0 ? lane : lanes.indexOf(null)
        if (target === -1) target = lanes.length
        lanes[target] = { hash: parent, color: index === 0 ? color : nextColor++ }
      }
      segments.push({ from: lane, to: target, start: 'node', end: 'bottom', color: lanes[target]!.color })
    }
    width = Math.max(width, lane + 1, lanes.length)
    while (lanes.length && lanes.at(-1) === null) lanes.pop()
    return { lane, color, segments }
  })
  return { rows, lanes: width }
}
