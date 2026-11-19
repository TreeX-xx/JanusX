export interface SessionReadIssue {
  engine: string
  path: string
  reason: 'missing' | 'permission-denied' | 'corrupt' | 'unsupported-schema' | 'unreadable' | 'scan-limit' | 'config-error'
}
export function sessionReadFailure(error: unknown): SessionReadIssue['reason'] {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied'
  const message = error instanceof Error ? error.message : ''
  if (/no such (table|column)/i.test(message)) return 'unsupported-schema'
  if (/malformed|not a database/i.test(message) || error instanceof SyntaxError) return 'corrupt'
  return 'unreadable'
}
