// Display policy shared by CLI and JanusX: .agents/notes/agent/requirements/chat-work-timeline.md
export interface WorkSummary {
  count: number
  running: number
  failed: number
  waiting: number
  interrupted: number
  incomplete: boolean
}

export function summarizeWork(items: { status: string; truncated?: boolean }[]): WorkSummary {
  const count = (states: string[]) => items.filter(item => states.includes(item.status)).length
  return {
    count: items.length,
    running: count(['inProgress', 'running', 'requested']),
    failed: count(['failed']),
    waiting: count(['approval']),
    interrupted: count(['cancelled', 'declined', 'denied', 'interrupted']),
    incomplete: items.some(item => item.truncated || !['completed', 'inProgress', 'running', 'requested', 'failed', 'approval', 'cancelled', 'declined', 'denied', 'interrupted'].includes(item.status)),
  }
}

/** Public content breaks a process run; updates never change its first-item identity. */
export function groupWorkOutput<T>(items: T[], isProcess: (item: T) => boolean, scope: (item: T) => string) {
  const groups: { items: T[]; process: boolean }[] = []
  for (const item of items) {
    const process = isProcess(item), previous = groups.at(-1)
    if (process && previous?.process && scope(previous.items[0]) === scope(item)) previous.items.push(item)
    else groups.push({ items: [item], process })
  }
  return groups
}
