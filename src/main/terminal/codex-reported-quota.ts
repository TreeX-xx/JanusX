// Note: .agents/notes/workbench/runtime-drawer-cards-resize.md
import { lstat, open } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseJsonLine } from '../sessions/transcript-kernel'
import type { CodexQuota, CodexQuotaWindow } from '../../shared/codex-quota'
import type { CodexRpc } from './codex-managed-transport'

function reportedWindow(raw: CodexRpc | null | undefined, updatedAt: number, now: number): CodexQuotaWindow | null {
  if (!raw || !Number.isFinite(raw.used_percent) || raw.used_percent < 0 || raw.used_percent > 100 ||
      !Number.isFinite(raw.window_minutes) || raw.window_minutes <= 0) return null
  const resetsAt = Number.isFinite(raw.resets_at) && raw.resets_at > 0 ? raw.resets_at * 1000 : null
  if (resetsAt !== null && resetsAt <= now) return null
  return { used: raw.used_percent, minutes: raw.window_minutes, resetsAt, updatedAt }
}

// undefined means keep looking; null means the newest report has no current window.
function latestReport(lines: string[], since: number, now: number): CodexQuota | null | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    const record = parseJsonLine(lines[i])
    const payload = record?.payload as CodexRpc | undefined
    if (record?.type !== 'event_msg' || payload?.type !== 'token_count') continue
    const raw = payload.rate_limits
    if (!raw || (raw.limit_id != null && raw.limit_id !== 'codex')) continue
    const updatedAt = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
    if (!Number.isFinite(updatedAt)) continue
    if (updatedAt < since) return null
    const primary = reportedWindow(raw.primary, updatedAt, now)
    const secondary = reportedWindow(raw.secondary, updatedAt, now)
    return primary || secondary ? { source: 'session', primary, secondary, updatedAt, unavailable: false, blocked: false } : null
  }
  return undefined
}

/** Look back past large tool output, within the rollout bound by this thread's App Server. */
export async function readReportedQuota(path: string, threadId: string, since: number): Promise<CodexQuota | null> {
  if (!/^[a-z0-9-]{1,100}$/i.test(threadId) || !basename(path).endsWith(`-${threadId}.jsonl`)) return null
  if (!(await lstat(path).catch(() => null))?.isFile()) return null
  const file = await open(path, 'r').catch(() => null)
  if (!file) return null
  try {
    let end = (await file.stat()).size
    const floor = Math.max(0, end - 8 * 1024 * 1024)
    const chunk = Buffer.alloc(64 * 1024)
    const now = Date.now()
    let suffix = ''
    while (end > floor) {
      const start = Math.max(floor, end - chunk.length)
      const { bytesRead } = await file.read(chunk, 0, end - start, start)
      if (bytesRead !== end - start) return null
      // Quota fields are ASCII. latin1 preserves bytes across arbitrary chunk boundaries.
      const lines = (chunk.toString('latin1', 0, bytesRead) + suffix).split('\n')
      suffix = start > 0 ? lines.shift()! : ''
      // Only token_count records are needed. Discard oversized partial tool rows.
      if (suffix.length > chunk.length) suffix = '\0'
      const report = latestReport(lines, since, now)
      if (report !== undefined) return report
      end = start
    }
    return null
  } catch {
    return null
  } finally {
    await file.close()
  }
}
