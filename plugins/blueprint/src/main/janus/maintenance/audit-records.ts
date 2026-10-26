// Note: migration reads historical receipts without starting maintenance — see .agents/notes/planning/blueprint-official-plugin.md
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson } from '../blueprint-persistence'
import type { BlueprintMaintenanceAuditListInput, BlueprintMaintenanceAuditRecord } from '../../../shared/janus/maintenance-types'

export function isAuditRecord(value: unknown): value is BlueprintMaintenanceAuditRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<BlueprintMaintenanceAuditRecord>
  const operations = record.changeSetSnapshot?.operations
  const validOperations = Array.isArray(operations) && operations.every((operation) => {
    if (!operation || typeof operation.operationId !== 'string') return false
    switch (operation.type) {
      case 'move-node': return typeof operation.afterParentId === 'string'
      case 'create-node':
      case 'update-node':
      case 'add-relation':
      case 'update-workspace-binding':
        return !!operation.after && typeof operation.after === 'object'
      case 'update-relation':
      case 'remove-relation':
        return typeof operation.relationId === 'string'
      case 'archive-node':
      case 'delete-node':
        return typeof operation.nodeId === 'string'
      case 'restore-node':
        return !!operation.node && typeof operation.node === 'object'
      default: return false
    }
  })
  const evidence = record.changeSetSnapshot?.evidence
  const validEvidence = evidence === undefined || (Array.isArray(evidence) && evidence.every((manifest) =>
    Array.isArray(manifest.files) && manifest.files.every((file) =>
      typeof file.path === 'string' && Array.isArray(file.supportsOperationIds))))
  return typeof record.id === 'string'
    && typeof record.blueprintId === 'string'
    && typeof record.taskId === 'string'
    && Array.isArray(record.selectedOperationIds)
    && validOperations
    && validEvidence
}

export async function readMaintenanceAudits(directory: string, input: BlueprintMaintenanceAuditListInput): Promise<BlueprintMaintenanceAuditRecord[]> {
  if (!input.blueprintId.trim()) throw new Error('蓝图 ID 不能为空')
  const files = await readdir(directory).catch(() => [])
  const records = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => {
    const record = await readJson<BlueprintMaintenanceAuditRecord>(join(directory, file)).catch(() => null)
    if (!isAuditRecord(record) || record.blueprintId !== input.blueprintId || (input.taskId && record.taskId !== input.taskId)) return null
    return record
  }))
  return records.filter((record): record is BlueprintMaintenanceAuditRecord => record !== null)
    .sort((a, b) => (b.appliedAt ?? b.createdAt).localeCompare(a.appliedAt ?? a.createdAt))
}
