import { useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { BlueprintChangeSet, BlueprintOperation } from '../../../../../plugins/blueprint/src/shared/janus/maintenance-types'
import { maintenanceSelection } from './maintenanceSelection'
import { MaintenanceFileReview, type MaintenanceReviewContext } from './MaintenanceFileReview'

export function OperationDetails({ operation }: { operation: BlueprintOperation }) {
  const { t } = useI18n('blueprint')
  const title = operation.type === 'delete-node' ? operation.impact.title
    : operation.type === 'create-node' ? operation.after.title
    : operation.type === 'restore-node' ? operation.node.title
    : 'nodeId' in operation ? operation.nodeId : 'relationId' in operation ? operation.relationId : operation.tempRelationId
  return <details className="bp-maintenance-operation-details">
    <summary>{operation.type} · {title}</summary>
    <p>{operation.reason}</p>
    {'before' in operation && <div>{t('blueprint:maintenance.auditBefore')}<pre>{JSON.stringify(operation.before, null, 2)}</pre></div>}
    {'after' in operation && <div>{t('blueprint:maintenance.auditAfter')}<pre>{JSON.stringify(operation.after, null, 2)}</pre></div>}
    {operation.type === 'move-node' && <p>{operation.beforeParentId} → {operation.afterParentId}</p>}
    {operation.type === 'archive-node' && <p>{operation.beforeStatus} → archived</p>}
    {operation.type === 'restore-node' && <pre>{JSON.stringify(operation.node, null, 2)}</pre>}
    {operation.type === 'delete-node' && <p>{t('blueprint:maintenance.deleteImpact', { children: operation.impact.childIds.length, incoming: operation.impact.incomingRelationIds.length, outgoing: operation.impact.outgoingRelationIds.length })}</p>}
    <small>{operation.risk} · {operation.operationId}</small>
    <p>{t('blueprint:maintenance.auditEvidence')}: {operation.evidenceRefs.join(', ') || t('blueprint:maintenance.auditNoEvidence')}</p>
    {operation.dependsOn.length > 0 && <p>{t('blueprint:maintenance.dependencies')}: {operation.dependsOn.join(', ')}</p>}
  </details>
}

/** The parent keys this component by the complete proposal content. */
export function MaintenanceApproval({ changeSet, busy, onApply, undo = false, reviewContext }: {
  changeSet: BlueprintChangeSet; busy: boolean; undo?: boolean
  reviewContext?: MaintenanceReviewContext
  onApply: (operationIds: string[], confirmedDeleteOperationIds: string[], previewId?: string) => Promise<void>
}) {
  const { t } = useI18n('blueprint')
  const [requested, setRequested] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState<string[]>([])
  const [deleteAll, setDeleteAll] = useState(false)
  let selected: BlueprintOperation[] = []
  let error = ''
  try { selected = maintenanceSelection(changeSet, requested) } catch (reason) { error = String(reason) }
  const selectedIds = new Set(selected.map(op => op.operationId))
  const groups = changeSet.groups?.length ? changeSet.groups : changeSet.operations.map(op => ({ id: op.operationId, title: op.reason, operationIds: [op.operationId] }))
  const change = (ids: string[], checked: boolean) => {
    setRequested(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)))
    setConfirmed([])
    setDeleteAll(false)
  }
  const bulkIds = changeSet.operations.filter(op => op.type !== 'delete-node').map(op => op.operationId)
  const selectedDeletes = selected.filter(op => op.type === 'delete-node')
  // One irreversible acknowledgement covers the whole delete set; per-operation
  // checkboxes made bulk approval a three-step ritual.
  const bulkConfirmed = deleteAll && selectedDeletes.length > 0
  const unconfirmed = selectedDeletes.length > 0 && !bulkConfirmed && !selectedDeletes.every(op => confirmed.includes(op.operationId))
  const apply = (previewId?: string) => onApply(selected.map(op => op.operationId), bulkConfirmed ? selectedDeletes.map(op => op.operationId) : confirmed, previewId)
  return <section className="bp-maintenance-approval" aria-label={undo ? t('blueprint:maintenance.undoTitle') : t('blueprint:maintenance.pendingProposal', { version: changeSet.version })}>
    <p>{changeSet.reason}</p>
    <small>{t('blueprint:maintenance.proposalSelection', { selected: selected.length, total: changeSet.operations.length })}</small>
    <fieldset disabled={busy}>
      <label><input type="checkbox" checked={bulkIds.length > 0 && bulkIds.every(id => requested.includes(id))} onChange={event => change(bulkIds, event.target.checked)} />{t('blueprint:maintenance.selectAll')}</label>
      {groups.map(group => <div className="bp-maintenance-approval-group" key={group.id}>
        <label><input type="checkbox" aria-label={group.title} checked={group.operationIds.every(id => selectedIds.has(id))}
          ref={element => { if (element) element.indeterminate = group.operationIds.some(id => selectedIds.has(id)) && !group.operationIds.every(id => selectedIds.has(id)) }}
          onChange={event => change(group.operationIds, event.target.checked)} />{group.title}</label>
        {group.operationIds.map(id => {
          const op = changeSet.operations.find(item => item.operationId === id)
          if (!op) return null
          const dependency = selectedIds.has(id) && !requested.includes(id)
          return <div key={id} className="bp-maintenance-approval-operation">
            <label><input type="checkbox" aria-label={t('blueprint:maintenance.selectOperation', { id })} checked={selectedIds.has(id)} disabled={dependency}
              onChange={event => change([id], event.target.checked)} />{id}{dependency ? ' · ' + t('blueprint:maintenance.dependencies') : ''}</label>
            <OperationDetails operation={op} />
          </div>
        })}
      </div>)}
      {selectedDeletes.length > 0 && <div className="bp-maintenance-delete-confirm">
        {selectedDeletes.length > 0 && <label>
          <input type="checkbox" checked={deleteAll || selectedDeletes.every(op => confirmed.includes(op.operationId))}
            ref={element => { if (element) element.indeterminate = !deleteAll && selectedDeletes.some(op => confirmed.includes(op.operationId)) && !selectedDeletes.every(op => confirmed.includes(op.operationId)) }}
            onChange={event => { setDeleteAll(event.target.checked); setConfirmed([]) }} />
          {t('blueprint:maintenance.deleteConfirmAll', { count: selectedDeletes.length })}
        </label>}
        {selectedDeletes.map(op => <small key={op.operationId}>{op.operationId} · {op.impact.title}</small>)}
      </div>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {reviewContext ? <MaintenanceFileReview input={{ ...reviewContext, operationIds: selected.map(op => op.operationId) }}
      disabled={busy || !!error || !selected.length || unconfirmed} label={t('blueprint:maintenance.approveSelected')} onApply={apply} /> : <button type="button" disabled={busy || !!error || !selected.length || unconfirmed} onClick={() => void apply()}>
      {t(undo ? 'blueprint:maintenance.undoApply' : 'blueprint:maintenance.approveSelected')}
    </button>}
  </section>
}
