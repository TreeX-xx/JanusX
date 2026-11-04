import { describe, expect, it } from 'vitest'
import type { KnowledgeRecallTrace } from '../../../src/shared/knowledge'
import type { ProductFileEntry } from '../../../src/shared/product'
import { reminderTemplate, dailyReviewTemplate, type AutomationRun } from '../../../src/shared/automations'
import {
  assembleNotifications,
  automationNotification,
  capsuleTier,
  EMPTY_CAPSULE_NOTIFICATION_ID,
  isEmptyCapsuleRequested,
  knowledgeNotification,
  maintenanceNotification,
  memoryNotification,
  notificationActionLabelKey,
  notificationKickerKey,
  notifySeverityRank,
  productNotification,
  topNotification,
} from '../../../src/renderer/src/components/janus/islandNotifications'

function recalledTrace(requestId: string): KnowledgeRecallTrace {
  return {
    requestId,
    status: 'recalled',
    query: 'island knowledge',
    recalledCount: 3,
    eligibleCount: 5,
    truncated: false,
    maxItems: 5,
    maxChars: 3000,
    topHit: {
      id: `fact-${requestId}`,
      kind: 'fact',
      title: `Top hit ${requestId}`,
      score: 0.8,
      provenance: { observationIds: [], factIds: [], fileRefs: [] },
    },
  }
}

function productEntry(relPath = 'src/report.docx'): ProductFileEntry {
  return { workspaceId: 'ws', relPath, ext: '.docx', kind: 'office', mtimeMs: 0, size: 1 } as ProductFileEntry
}

function maintenanceTask(overrides: Partial<Record<'id' | 'status' | 'blueprintName' | 'phase' | 'progress', string | number>> = {}) {
  return {
    id: 'task-1',
    blueprintId: 'bp',
    blueprintName: 'Janus Core',
    nodeScope: { type: 'blueprint' } as never,
    status: 'analyzing',
    phase: 'analyzing',
    progress: 40,
    updatedAt: 0,
    ...overrides,
  } as never
}

describe('island notification capsule model', () => {
  it('groups reminders by definition while retaining the latest run target and full message', () => {
    const run: AutomationRun = { id: 'run', definitionId: 'phone', occurrenceKey: 'minute', trigger: 'scheduled',
      state: 'succeeded', startedAt: '2026-11-03T00:00:00Z', message: 'Check your phone', tasks: [],
      cursor: { commit: '', epoch: 0, partialCount: 0, attention: false },
      snapshot: { ...reminderTemplate('Check your phone'), id: 'phone', revision: 1, root: '', createdAt: '', nextRunAt: null } }
    expect(automationNotification(run)).toMatchObject({ groupKey: 'reminder:phone', automation: { definitionId: 'phone', id: 'run' }, copy: { subtitleText: 'Check your phone' } })
    expect(automationNotification({ ...run, snapshot: { ...run.snapshot, ...dailyReviewTemplate('project') } }).groupKey).toBeUndefined()
  })
  it('ranks severities in the documented order', () => {
    expect(notifySeverityRank('failed')).toBeGreaterThan(notifySeverityRank('attention'))
    expect(notifySeverityRank('attention')).toBeGreaterThan(notifySeverityRank('success'))
    expect(notifySeverityRank('success')).toBeGreaterThan(notifySeverityRank('info'))
  })

  it('dedupes by id and sorts by severity rank then newest', () => {
    const knowledge = knowledgeNotification({ active: true, empty: false, trace: recalledTrace('a'), now: 10 })
    const product = productNotification(productEntry(), 20)
    const attention = maintenanceNotification(
      maintenanceTask({ status: 'stale', phase: 'stale' }),
      true,
      30,
    )
    expect(knowledge && product && attention).toBeTruthy()
    const assembled = assembleNotifications([attention, product, knowledge, attention])
    expect(assembled.map((n) => n.id)).toEqual([attention!.id, product!.id, knowledge!.id])
  })

  it('keeps insertion order for same-severity ties', () => {
    const knowledge = knowledgeNotification({ active: true, empty: false, trace: recalledTrace('a'), now: 10 })
    const maintenance = maintenanceNotification(maintenanceTask(), false, 10)
    const assembled = assembleNotifications([knowledge, maintenance])
    expect(assembled).toHaveLength(2)
    expect(assembled[0]!.kind).toBe('knowledge')
  })

  it('projects the knowledge notification with mono subtitle values and ready meta', () => {
    const notification = knowledgeNotification({ active: true, empty: false, trace: recalledTrace('a'), matchLabel: '强匹配' })
    expect(notification).not.toBeNull()
    expect(notification!.id).toBe('knowledge:a')
    expect(notification!.copy.subtitleValues).toMatchObject({ count: 3, match: '强匹配' })
    expect(notification!.copy.metaKey).toBe('janus:island.status.knowledgeReady')
  })

  it('suppresses inactive and empty knowledge projections', () => {
    expect(knowledgeNotification({ active: false, empty: false, trace: recalledTrace('a') })).toBeNull()
    expect(knowledgeNotification({ active: true, empty: true, trace: null })).toBeNull()
    expect(knowledgeNotification({ active: true, empty: false, trace: null })).toBeNull()
  })

  it('forks the product title by notice kind (added vs modified)', () => {
    const entry = { relPath: 'out/report.md', ext: '.md', size: 1, mtimeMs: 1 }
    expect(productNotification({ ...entry, noticeKind: 'added' })!.copy.titleKey).toBe('janus:island.peek.title.productReady')
    expect(productNotification({ ...entry, noticeKind: 'modified' })!.copy.titleKey).toBe('janus:island.peek.title.productUpdated')
    expect(productNotification(entry)!.copy.titleKey).toBe('janus:island.peek.title.productReady')
  })

  it('projects the product notification with a path subtitle', () => {
    const notification = productNotification(productEntry('out/demo.md'), 5)
    expect(notification!.id).toBe('product:out/demo.md')
    expect(notification!.severity).toBe('success')
    expect(notification!.copy.subtitleText).toBe('out/demo.md')
    expect(productNotification(null)).toBeNull()
  })

  it('maps maintenance attention over normal info and carries blueprint meta', () => {
    const attention = maintenanceNotification(maintenanceTask({ status: 'proposal-ready', phase: 'proposal' }), true)
    expect(attention!.severity).toBe('attention')
    expect(attention!.copy.titleKey).toBe('janus:island.peek.title.proposalReady')

    const failed = maintenanceNotification(maintenanceTask({ status: 'failed', phase: 'apply' }), true)
    expect(failed!.severity).toBe('failed')

    const normal = maintenanceNotification(maintenanceTask(), false)
    expect(normal!.severity).toBe('info')
    expect(normal!.copy.subtitleText).toContain('40%')
    expect(normal!.progress).toBe(40)
    expect(maintenanceNotification(null, true)).toBeNull()
  })

  it('sizes capsule tiers: copy decides single vs double; empty stays double', () => {
    expect(capsuleTier(null, true)).toBe('double')
    const knowledge = knowledgeNotification({ active: true, empty: false, trace: recalledTrace('a') })!
    expect(capsuleTier(knowledge, false)).toBe('double')
    expect(capsuleTier({ ...knowledge, copy: { ...knowledge.copy, subtitleKey: undefined } }, false)).toBe('single')
  })


  it('requests the empty launcher only when nothing else is on the tray', () => {
    const knowledge = knowledgeNotification({ active: true, empty: false, trace: recalledTrace('a') })!
    expect(isEmptyCapsuleRequested(true, [])).toBe(true)
    expect(isEmptyCapsuleRequested(true, [knowledge])).toBe(false)
    expect(isEmptyCapsuleRequested(false, [])).toBe(false)
    expect(topNotification([])).toBeNull()
    expect(topNotification([knowledge])).toBe(knowledge)
    expect(EMPTY_CAPSULE_NOTIFICATION_ID).toBe('capsule-empty')
  })

  it('projects the memory badge only while habits await review', () => {
    expect(memoryNotification({ pendingHabitCount: 0 })).toBeNull()
    expect(memoryNotification({ pendingHabitCount: -1 })).toBeNull()
    const notification = memoryNotification({ pendingHabitCount: 2, now: 7 })!
    expect(notification.id).toBe('memory:pending:2')
    expect(notification.kind).toBe('memory')
    expect(notification.severity).toBe('info')
    expect(notification.copy.titleKey).toBe('janus:island.peek.title.memoryHabits')
    expect(notification.copy.subtitleValues).toMatchObject({ count: 2 })
    expect(notification.actions).toEqual([{ id: 'open-memory', primary: true }])
    expect(notificationKickerKey('memory')).toBe('janus:island.capsule.kicker.memory')
    expect(notificationActionLabelKey('open-memory')).toBe('janus:island.capsule.action.openMemory')
    const assembled = assembleNotifications([notification, knowledgeNotification({ active: true, empty: false, trace: recalledTrace('a'), now: 10 })])
    expect(assembled.map((n) => n.kind)).toEqual(['knowledge', 'memory'])
  })
})
