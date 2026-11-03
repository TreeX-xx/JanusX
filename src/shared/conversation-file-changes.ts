import type { ConversationItem } from './conversation-display'

export interface ConversationChangedFile {
  path: string
  patches: string[]
  additions: number
  deletions: number
  countsKnown: boolean
}

// Note: turn-local receipts, not working-tree diff — .agents/notes/workbench/terminal-dialog-dual-mode.md
export function conversationFileChanges(items: ConversationItem[]) {
  const turns = new Map<string, { files: ConversationChangedFile[]; incomplete: boolean }>()
  for (const item of items) {
    if (item.type !== 'fileChange' || item.status !== 'completed' || !item.files?.length) continue
    let turn = turns.get(item.turnId)
    if (!turn) { turn = { files: [], incomplete: false }; turns.set(item.turnId, turn) }
    turn.incomplete ||= !!item.truncated
    for (const receipt of item.files) {
      let file = turn.files.find(file => file.path === receipt.path)
      if (!file) {
        file = { path: receipt.path, patches: [], additions: 0, deletions: 0, countsKnown: true }
        turn.files.push(file)
      }
      file.patches.push(receipt.diff)
      // Only unified hunks have reliable line semantics across providers.
      let inHunk = false
      let hasHunk = false
      for (const line of receipt.diff.split('\n')) {
        if (/^@@ /.test(line)) { inHunk = true; hasHunk = true; continue }
        if (line.startsWith('diff ')) { inHunk = false; continue }
        if (!inHunk) continue
        if (line.startsWith('+')) file.additions++
        if (line.startsWith('-')) file.deletions++
      }
      file.countsKnown &&= hasHunk && !item.truncated
    }
  }
  return turns
}
