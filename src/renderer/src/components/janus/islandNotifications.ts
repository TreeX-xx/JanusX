// Note: 灵动岛通知胶囊（一级展开 peek 与二级展开 expanded 通知面的统一内容模型）—
// see .agents/notes/workbench/island-hifi-optimized-alignment.md
import type { KnowledgeRecallTrace } from '../../../../shared/knowledge'
import type { ProductFileEntry } from '../../../../shared/product'
import type { BlueprintMaintenanceTask } from '../../../../../plugins/blueprint/src/shared/janus/maintenance-types'
import type { PluginIslandEntry } from '../../../../shared/ipc/plugins'

export type IslandNotificationKind = 'knowledge' | 'memory' | 'product' | 'maintenance' | 'agent' | 'plugin'
export type IslandNotificationSeverity = 'info' | 'success' | 'attention' | 'failed'
export type IslandCapsuleTier = 'single' | 'double'
export type IslandNotificationActionId =
  | 'open-knowledge'
  | 'open-memory'
  | 'open-product'
  | 'open-blueprint'
  | 'open-maintenance'
  | 'open-plugin'

export interface IslandNotificationAction {
  id: IslandNotificationActionId
  primary?: boolean
  label?: string
  command?: string
}

/** i18n copy bundle: keys are resolved by the rendering layer via `t()`. */
export interface IslandNotificationCopy {
  titleKey: string
  titleText?: string
  subtitleKey?: string
  subtitleValues?: Record<string, unknown>
  /** Literal subtitle (mono paths, progress bars) that bypasses i18n. */
  subtitleText?: string
  metaKey?: string
  metaValues?: Record<string, unknown>
}

export interface IslandNotification {
  /** Content-addressed: new trace requestId / product relPath forces re-notify. */
  id: string
  kind: IslandNotificationKind
  severity: IslandNotificationSeverity
  copy: IslandNotificationCopy
  actions: IslandNotificationAction[]
  createdAt: number
  /** 0-100 task progress — in-flight maintenance rows render a micro progress bar. */
  progress?: number
  plugin?: PluginIslandEntry
  order?: number
}

/** Higher ranks interrupt more; ties break by newest. */
const SEVERITY_RANK: Record<IslandNotificationSeverity, number> = {
  failed: 4,
  attention: 3,
  success: 2,
  info: 1,
}

export function notifySeverityRank(severity: IslandNotificationSeverity): number {
  return SEVERITY_RANK[severity]
}

/**
 * Assembles the live notification tray from per-source projections. Dedupes
 * by id, sorts by severity rank desc then createdAt desc, keeping insertion
 * order as the final tiebreak (stable sort).
 */
export function assembleNotifications(
  parts: Array<IslandNotification | null | undefined>,
): IslandNotification[] {
  const byId = new Map<string, IslandNotification>()
  for (const part of parts) {
    if (!part) continue
    byId.set(part.id, part)
  }
  return [...byId.values()].sort((a, b) => {
    // Host notices always precede external contributions, regardless of severity.
    if ((a.kind === 'plugin') !== (b.kind === 'plugin')) return a.kind === 'plugin' ? 1 : -1
    const rank = notifySeverityRank(b.severity) - notifySeverityRank(a.severity)
    if (rank !== 0) return rank
    if (a.kind === 'plugin' && b.kind === 'plugin') {
      const order = (a.order ?? 100) - (b.order ?? 100)
      if (order !== 0) return order
    }
    return b.createdAt - a.createdAt
  })
}

export function topNotification(list: IslandNotification[]): IslandNotification | null {
  return list[0] ?? null
}

/** Capsule height tier: single-row kicker+title, double adds the subtitle row.
 * The peek capsule carries no jump actions — only the expanded tray/banner do. */
export function capsuleTier(
  notification: IslandNotification | null,
  isEmptyCapsule: boolean,
): IslandCapsuleTier {
  if (isEmptyCapsule) return 'double'
  if (!notification) return 'single'
  return notification.copy.subtitleKey || notification.copy.subtitleText ? 'double' : 'single'
}

/** Attention-and-above may auto-raise the expanded banner; info only pulses the badge. */
export function mayAutoBanner(severity: IslandNotificationSeverity): boolean {
  return severity === 'attention' || severity === 'failed'
}

export function notificationKickerKey(kind: IslandNotificationKind): string {
  return `janus:island.capsule.kicker.${kind}`
}

const ACTION_LABEL_KEYS: Record<IslandNotificationActionId, string> = {
  'open-knowledge': 'janus:island.capsule.action.openKnowledge',
  'open-memory': 'janus:island.capsule.action.openMemory',
  'open-product': 'janus:island.capsule.action.openProduct',
  'open-blueprint': 'janus:island.capsule.action.openBlueprint',
  'open-maintenance': 'janus:island.capsule.action.openMaintenance',
  'open-plugin': 'plugins:open',
}

export function notificationActionLabelKey(id: IslandNotificationActionId): string {
  return ACTION_LABEL_KEYS[id]
}

export function knowledgeNotification(input: {
  active: boolean
  empty: boolean
  trace: KnowledgeRecallTrace | null
  matchLabel?: string
  now?: number
}): IslandNotification | null {
  const { active, empty, trace, matchLabel, now = Date.now() } = input
  if (!active) return null
  if (empty || !trace?.topHit) return null
  return {
    id: `knowledge:${trace.requestId}`,
    kind: 'knowledge',
    severity: 'info',
    copy: {
      titleKey: 'janus:island.peek.title.knowledgeRecalled',
      subtitleKey: 'janus:island.peek.subtitle.knowledgeCount',
      subtitleValues: {
        count: trace.recalledCount,
        match: matchLabel,
        kind: trace.topHit.kind,
        title: trace.topHit.title,
      },
      metaKey: trace.truncated
        ? 'janus:island.status.knowledgeTruncated'
        : 'janus:island.status.knowledgeReady',
    },
    actions: [{ id: 'open-knowledge', primary: true }],
    createdAt: now,
  }
}

/**
 * User memory M4: quiet badge for habit candidates awaiting Inbox review.
 * Info severity only pulses the badge, never auto-raises the banner. The id
 * carries the pending count so new candidates re-notify.
 */
export function memoryNotification(input: {
  pendingHabitCount: number
  now?: number
}): IslandNotification | null {
  const { pendingHabitCount, now = Date.now() } = input
  if (!Number.isFinite(pendingHabitCount) || pendingHabitCount <= 0) return null
  return {
    id: `memory:pending:${Math.trunc(pendingHabitCount)}`,
    kind: 'memory',
    severity: 'info',
    copy: {
      titleKey: 'janus:island.peek.title.memoryHabits',
      subtitleKey: 'janus:island.peek.subtitle.memoryPending',
      subtitleValues: { count: Math.trunc(pendingHabitCount) },
    },
    actions: [{ id: 'open-memory', primary: true }],
    createdAt: now,
  }
}

export function productNotification(
  entry: (ProductFileEntry & { noticeKind?: 'added' | 'modified' }) | null,
  now = Date.now(),
): IslandNotification | null {
  if (!entry) return null
  // Notice matrix (Note: product-workspace.md): added = new
  // file (island pops); modified = baseline file changed for the first time
  // (tray row only, same success tier).
  const updated = entry.noticeKind === 'modified'
  return {
    id: `product:${entry.relPath}`,
    kind: 'product',
    severity: 'success',
    copy: {
      titleKey: updated ? 'janus:island.peek.title.productUpdated' : 'janus:island.peek.title.productReady',
      subtitleText: entry.relPath,
      metaKey: 'janus:island.status.productOpenPreview',
    },
    actions: [{ id: 'open-product', primary: true }],
    createdAt: now,
  }
}

export function maintenanceNotification(
  task: BlueprintMaintenanceTask | null,
  needsAttention: boolean,
  now = Date.now(),
): IslandNotification | null {
  if (!task) return null
  if (needsAttention) {
    return {
      id: `maintenance:${task.id}:${task.status}`,
      kind: 'maintenance',
      severity: task.status === 'failed' ? 'failed' : 'attention',
      copy: {
        titleKey: task.status === 'proposal-ready'
          ? 'janus:island.peek.title.proposalReady'
          : 'janus:island.peek.title.needsAttention',
        subtitleText: `${task.blueprintName} | ${task.phase}`,
        metaKey: 'janus:island.status.blueprintStatus',
        metaValues: { status: task.status.toUpperCase() },
      },
      actions: [{ id: 'open-maintenance', primary: true }],
      progress: task.progress,
      createdAt: now,
    }
  }
  return {
    id: `maintenance:${task.id}:${task.status}`,
    kind: 'maintenance',
    severity: 'info',
    copy: {
      titleKey: 'janus:island.peek.title.maintenance',
      subtitleText: `${task.blueprintName} | ${task.progress}% | ${task.phase}`,
      metaKey: 'janus:island.status.blueprintStatus',
      metaValues: { status: task.status.toUpperCase() },
    },
    actions: [{ id: 'open-maintenance' }],
    progress: task.progress,
    createdAt: now,
  }
}

/** Empty-state launcher capsule shown when single-activating with no notifications. */
export const EMPTY_CAPSULE_NOTIFICATION_ID = 'capsule-empty'

export function isEmptyCapsuleRequested(empty: boolean, list: IslandNotification[]): boolean {
  return empty && list.length === 0
}
