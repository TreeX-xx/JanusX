// Note: maintenance proposals land on project graphs here — see .agents/notes/agent/maintenance-harness-apply-s6.md
/**
 * @file Maintenance -> harness apply wiring (S6-c slice 2b)
 * @description Consumes the pure translator from maintenance-bridge and lands
 *  the result through HarnessNoteService.applyBundleChangeSet. Translation is
 *  all-or-nothing: any refusal fails loudly before any byte is written, so a
 *  partial bridge never reaches the transaction. Crash recovery between the
 *  journal commit and the response replays through the harness journal; a
 *  brand-new apply call of one selection behaves like the legacy lane (a
 *  create runs again), so callers must not blindly retry a successful apply.
 *
 *  No Electron here: checkout roots arrive from callers, workspace scanning
 *  arrives as an injected lister. No model calls, no discussion loop.
 */
import { randomUUID } from 'node:crypto'
import { parseNote } from '@janus-agent/harness-core'
import { noteFileName } from '@janus-agent/harness-node'
import type { Blueprint } from '../../shared/janus/types'
import type { BlueprintOperation, BlueprintMaintenanceFilePreview } from '../../shared/janus/maintenance-types'
import { translateMaintenanceOpsToHarness, type BridgeResult } from './maintenance-bridge'
import type { BlueprintNotes as HarnessNoteService } from './service'
import { noteAuthoringContext, maintainedNotePath } from './note-authoring'

export interface ProjectCheckout {
  root: string
  repoId: string
  repoName: string
  rev: number
  blueprint: Blueprint
}

export interface HarnessSelectionRequest {
  sourceHashes?: Record<string, string>
  root: string
  repoId: string
  operations: BlueprintOperation[]
  taskId: string
  changeSetVersion: number
  reason: string
}

export interface HarnessSelectionResult {
  txId: string
  /** Maintenance operation ids covered by the applied bridge, in apply order. */
  appliedMaintenanceIds: string[]
  /** tempNodeId -> minted note id for creates in this selection. */
  createdNodeIds: Record<string, string>
  /** tempRelationId -> synthetic projection id for adds in this selection. */
  createdRelationIds: Record<string, string>
}

/**
 * Resolves the explicitly bound checkout. A failed explicit binding must not
 * fall through to another registered workspace. Discovery is available only
 * when no binding was supplied and still refuses ambiguous graph ids.
 */
export async function resolveProjectCheckout(
  service: HarnessNoteService,
  blueprintId: string,
  preferredPath?: string,
  listWorkspacePaths?: () => Promise<string[]>,
): Promise<ProjectCheckout> {
  const tried: string[] = []
  let missingRepo = false
  const attempt = async (candidate: string): Promise<ProjectCheckout | null> => {
    tried.push(candidate)
    const resolved = await service.resolveRoot(candidate).catch(() => null)
    if (!resolved?.ok || !resolved.root) return null
    const view = await service.projectView(resolved.root)
    if (view.blueprint.id !== blueprintId) return null
    if (!view.repoId) {
      missingRepo = true
      return null
    }
    return { root: resolved.root, repoId: view.repoId, repoName: view.repoName, rev: view.rev, blueprint: view.blueprint }
  }
  if (preferredPath) {
    const hit = await attempt(preferredPath)
    if (hit) return hit
    throw new Error('找不到项目 Note 的本机 checkout（' + blueprintId + '）：绑定目录不可用或不匹配，请重新确认绑定')
  }
  if (listWorkspacePaths) {
    const matches: ProjectCheckout[] = []
    for (const candidate of await listWorkspacePaths()) {
      if (tried.includes(candidate)) continue
      const hit = await attempt(candidate)
      if (hit) matches.push(hit)
    }
    // Ids are checkout-scoped rootKey hashes (E0-1), so a scan normally hits
    // exactly one checkout. The guard stays as defense-in-depth (e.g. one
    // checkout listed twice under different path spellings): choosing
    // silently would write the wrong files.
    if (matches.length > 1) {
      throw new Error(`项目 Note 有多个本机 checkout（${blueprintId}）：${matches.map((m) => m.root).join('、')}，请先明确绑定目录`)
    }
    if (matches.length === 1) return matches[0]
  }
  if (missingRepo) throw new Error('项目 Note 缺少 repo 身份：先在 .agents/harness.json 填写 repoId 才能维护')
  throw new Error(`找不到项目 Note 的本机 checkout（${blueprintId}）：已尝试 ${tried.length} 个位置，请先绑定可写目录`)
}

/**
 * Keeps the legacy node-scope gate on the harness lane. Proposal-local temp
 * ids always pass; every other referenced node or relation owner must sit
 * inside the allowed set. Unparseable relation ids pass here and fail loudly
 * inside the translator instead of being silently dropped.
 */
export function assertHarnessScope(operations: BlueprintOperation[], allowed: Set<string>, blueprint?: Blueprint): void {
  const temps = new Set<string>()
  for (const op of operations) {
    if (op.type === 'create-node') temps.add(op.tempNodeId)
    if (op.type === 'add-relation') temps.add(op.tempRelationId)
  }
  const inside = (id: string): boolean => temps.has(id) || allowed.has(id)
  const violations: string[] = []
  const check = (operationId: string, id: string | null | undefined): void => {
    if (id && !inside(id)) violations.push(`${operationId}: ${id}`)
  }
  for (const op of operations) {
    switch (op.type) {
      case 'create-node': check(op.operationId, op.parentId); break
      case 'update-node':
      case 'move-node':
      case 'archive-node':
      case 'delete-node':
      case 'restore-node': check(op.operationId, op.nodeId); break
      case 'add-relation':
        check(op.operationId, op.after.sourceNodeId)
        check(op.operationId, op.after.targetNodeId)
        break
      case 'update-relation':
      case 'remove-relation': {
        const relation = blueprint?.relations.find(item => item.id === op.relationId)
        if (relation) {
          check(op.operationId, relation.sourceNodeId)
          break
        }
        const parts = op.relationId.split(':')
        check(op.operationId, parts.length === 3 && parts[0] ? parts[0] : null)
        break
      }
      case 'update-workspace-binding': check(op.operationId, op.nodeId); break
    }
    if (op.type === 'move-node') check(op.operationId, op.afterParentId)
    if (op.type === 'restore-node') {
      if (op.node.parentId) check(op.operationId, op.node.parentId)
      for (const relation of op.relations) {
        check(op.operationId, relation.sourceNodeId)
        check(op.operationId, relation.targetNodeId)
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`维护节点范围外禁止写入：${violations.slice(0, 5).join('；')}${violations.length > 5 ? ` 等 ${violations.length} 项` : ''}`)
  }
}

/**
 * Translates one maintenance selection and applies it as a single harness
 * transaction. Throws with every refusal reason and writes nothing when the
 * bridge is incomplete; concurrent external edits surface HARNESS_CONFLICT
 * from the transaction instead of overwriting.
 */
export interface PreparedMaintenanceSelection {
  request: HarnessSelectionRequest
  bridge: BridgeResult
  files: BlueprintMaintenanceFilePreview[]
  bundleId: string
}

// Note: preview and application consume the same translated bytes — see .agents/notes/blueprint/maintenance/blueprint-maintenance-approval-gap.md
export async function prepareMaintenanceSelection(
  service: HarnessNoteService,
  req: HarnessSelectionRequest,
): Promise<PreparedMaintenanceSelection> {
  const snapshots = new Map<string, { uri: string; expectedHash: string; markdown: string; path: string }>()
  const view = await service.projectView(req.root)
  if (view.repoId !== req.repoId) {
    throw new Error(`仓库身份已变化：期望 ${req.repoId}，当前 ${view.repoId ?? '未初始化'}，请重新确认绑定`)
  }
  for (const nodeId of view.blueprint.nodeIds) {
    try {
      const read = await service.readNote(req.root, nodeId)
      snapshots.set(nodeId, {
        uri: `note://${req.repoId}/${nodeId}`,
        expectedHash: read.sha256,
        markdown: read.raw,
        path: read.relPath,
      })
    } catch {
      // Invalid notes stay out of the bridge context; touching them fails
      // loudly inside the translator as an unknown note.
    }
  }
  // The composition projection uses opaque relation ids; the legacy bridge
  // expects owner:type:target. Resolve through the current checkout, never by
  // splitting an opaque id or trusting the caller's before snapshot.
  const operations = req.operations.map(op => {
    if (op.type !== 'update-relation' && op.type !== 'remove-relation') return op
    const relation = view.blueprint.relations.find(item => item.id === op.relationId)
    if (!relation) return op
    const matches = view.blueprint.relations.filter(item => item.sourceNodeId === relation.sourceNodeId
      && item.targetNodeId === relation.targetNodeId && item.type === relation.type)
    if (matches.length !== 1) throw new Error('项目 Note 关系声明不唯一，请先明确需要维护的关系')
    return { ...op, relationId: [relation.sourceNodeId, relation.type, relation.targetNodeId].join(':') }
  })
  const bridge = translateMaintenanceOpsToHarness(operations, {
    repoId: req.repoId,
    authoring: operations.some(op => op.type === 'create-node') ? await noteAuthoringContext(service, req.root) : undefined,
    resolveNote: (nodeId: string) => {
      const snapshot = snapshots.get(nodeId)
      if (req.sourceHashes && snapshot && req.sourceHashes[nodeId] !== snapshot.expectedHash) {
        throw new Error(`HARNESS_CONFLICT: ${snapshot.uri} source changed since proposal; regenerate and confirm`)
      }
      return snapshot ?? null
    },
  })
  if (!bridge.complete) {
    const reasons = bridge.untranslatable.map((item) => `${item.operationId}: ${item.reason}`)
    throw new Error(`项目 Note 转换失败，未写入任何内容：${reasons.slice(0, 5).join('；')}${reasons.length > 5 ? ` 等 ${reasons.length} 项` : ''}`)
  }
  const taken = new Set([...snapshots.values()].map(item => item.path?.split('/').pop()?.toLowerCase() ?? ''))
  const files = await Promise.all(bridge.ops.map(async op => {
    const original = snapshots.get(op.uri.split('/').pop()!)
    const note = op.type === 'create' ? parseNote(op.afterMarkdown) : null
    const authoring = note?.meta.schema === 'harness-note/2' ? await noteAuthoringContext(service, req.root, note.meta.module) : undefined
    const path = note && authoring
      ? `.agents/notes/${maintainedNotePath(authoring.directory!, note.title)}` : note
      ? `.agents/notes/${noteFileName(note.meta.created, note.title, note.meta.id, taken)}`
      : original!.path
    return {
      uri: op.uri, path, kind: op.type, reason: op.reason, operationIds: op.maintenanceOperationIds,
      before: original?.markdown ?? '', after: op.afterMarkdown,
      ...(op.downgraded ? { archivedInsteadOfDeleted: true } : {}),
    }
  }))
  const request = structuredClone(req)
  request.operations = request.operations.map(op => op.type === 'update-node' && bridge.sectionBaselines[op.operationId]
    ? { ...op, before: { ...op.before, sections: bridge.sectionBaselines[op.operationId] } } : op)
  return { request, bridge, files, bundleId: `maintenance-${req.taskId}-${randomUUID()}` }
}

export async function applyPreparedMaintenanceSelection(
  service: HarnessNoteService,
  prepared: PreparedMaintenanceSelection,
  assertCurrent?: () => void,
): Promise<HarnessSelectionResult> {
  const { request: req, bridge, files } = prepared
  for (const file of files) {
    if (file.kind === 'create') continue
    const current = await service.readNote(req.root, file.uri.split('/').pop()!)
    const op = bridge.ops.find(item => item.uri === file.uri)!
    if (current.relPath !== file.path || current.sha256 !== op.expectedHash) {
      throw new Error(`HARNESS_CONFLICT: ${file.path} changed since preview; regenerate and confirm`)
    }
  }
  assertCurrent?.()
  const applied = await service.applyBundleChangeSet(
    req.root,
    {
      id: prepared.bundleId,
      revision: req.changeSetVersion,
      source: { type: 'harness', id: `maintenance:${req.taskId}`, revision: req.changeSetVersion },
      operations: bridge.ops.map((op) => ({
        operationId: op.operationId,
        type: op.type,
        uri: op.uri,
        expectedHash: op.expectedHash,
        afterMarkdown: op.afterMarkdown,
        ...(op.type === 'create' ? { relativePath: files.find(file => file.uri === op.uri)!.path.replace(/^\.agents\/notes\//, '') } : {}),
        dependsOn: op.dependsOn,
        evidenceRefs: op.evidenceRefs,
      })),
    },
    req.reason,
  )
  const appliedSet = new Set(applied.applied.map((item) => item.operationId))
  const createdRelationIds: Record<string, string> = {}
  if (Object.keys(bridge.createdRelations).length) {
    const fresh = await service.projectView(req.root)
    for (const [tempId, ref] of Object.entries(bridge.createdRelations)) {
      const relation = fresh.blueprint.relations.find(item => item.sourceNodeId === ref.ownerId
        && item.targetNodeId === ref.targetId && item.type === ref.type)
      if (relation) createdRelationIds[tempId] = relation.id
    }
  }
  return {
    txId: applied.txId,
    appliedMaintenanceIds: bridge.ops.filter((op) => appliedSet.has(op.operationId)).flatMap((op) => op.maintenanceOperationIds),
    createdNodeIds: { ...bridge.createdNodeIds },
    createdRelationIds,
  }
}

export async function applyMaintenanceSelection(service: HarnessNoteService, req: HarnessSelectionRequest): Promise<HarnessSelectionResult> {
  return applyPreparedMaintenanceSelection(service, await prepareMaintenanceSelection(service, req))
}
