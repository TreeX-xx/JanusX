export type WorkerShortcut = { kind: 'backend'; backend: 'codex' | 'claude' }
  | { kind: 'worker'; workId: string; workspaceId: string; title: string }
export function normalizeWorkerShortcut(value: unknown): WorkerShortcut | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as WorkerShortcut
  if (row.kind === 'backend' && ['codex', 'claude'].includes(row.backend)) return { kind: 'backend', backend: row.backend }
  if (row.kind === 'worker' && [row.workId, row.workspaceId, row.title].every(text => typeof text === 'string' && text.length > 0 && text.length <= 200)) {
    return { kind: 'worker', workId: row.workId, workspaceId: row.workspaceId, title: row.title }
  }
}
export const workerShortcutLabel = (target: WorkerShortcut) => target.kind === 'worker' ? `@${target.title}` : `#${target.backend === 'claude' ? 'Claude Code' : 'Codex'}`
