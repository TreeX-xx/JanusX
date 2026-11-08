// Display policy shared by CLI and JanusX: .agents/notes/agent/requirements/chat-work-timeline.md
export interface WorkSummary {
  count: number
  running: number
  failed: number
  waiting: number
  interrupted: number
  incomplete: boolean
  unknown: number
  rejected: number
}

export function summarizeWork(items: { status: string; truncated?: boolean }[]): WorkSummary {
  const count = (states: string[]) => items.filter(item => states.includes(item.status)).length
  return {
    count: items.length,
    running: count(['inProgress', 'running', 'requested']),
    failed: count(['failed']),
    waiting: count(['approval']),
    interrupted: count(['cancelled', 'interrupted']),
    rejected: count(['declined', 'denied']),
    unknown: items.filter(item => !['completed', 'inProgress', 'running', 'requested', 'failed', 'approval', 'cancelled', 'declined', 'denied', 'interrupted'].includes(item.status)).length,
    incomplete: items.some(item => item.truncated),
  }
}

/** Only explicit display targets; never stringify arbitrary tool inputs or prompts. */
export function toolActivity(name: string, input: Record<string, unknown> = {}): string {
  const target = [input.command, input.cmd, input.file_path, input.filePath, input.path, input.pattern, input.query, input.description]
    .find(value => typeof value === 'string' && value.trim())
  return [name, target].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim().slice(0, 240)
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
