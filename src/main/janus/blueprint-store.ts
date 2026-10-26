/**
 * @file Blueprint 存储层
 * @description 应用级全局蓝图持久化（design §2.6）。
 *              存储目录：
 *                {userData}/janusx/blueprints/{blueprintId}.json
 *                {userData}/janusx/blueprints/index.json
 *
 *              焦点（归属机制 B）：每个 workspace 同时最多一个焦点节点，
 *              cursor 为 `focusedNodeId`，commit 归焦点节点。
 *
 *              并发安全：所有公开方法经 ReentrantAsyncLock 串行化（store 级单锁，
 *              因 index.json 跨蓝图共享，避免 per-blueprint 双锁死锁），
 *              writeJson 为 temp+rename 原子写，防止退出期截断丢蓝图（audit C2）。
 *
 *              模块划分（audit A1）：路径 → blueprint-paths，工厂 → blueprint-factory，
 *              JSON 持久化 → blueprint-persistence，候选去重 → requirement-candidates，
 *              本文件只保留编排、缓存与图操作。
 */

import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ReentrantAsyncLock } from '../lib/atomic-file'
import {
  GLOBAL_BLUEPRINT_SCOPE,
  blueprintFile,
  indexFile,
  legacyBlueprintFile,
  legacyIndexFile,
  workspacesDir
} from './blueprint-paths'
import { makeFeatureItem, makeNode, normalizeFeatureStatus, nowIso } from '../../../plugins/blueprint/src/main/janus/blueprint-factory'
import { readJson, writeJson } from '../../../plugins/blueprint/src/main/janus/blueprint-persistence'
import { candidateKey, resolveSuggestedParentId } from '../../../plugins/blueprint/src/main/janus/requirement-candidates'
import type {
  Blueprint,
  BlueprintFeatureItem,
  BlueprintFeatureStatus,
  BlueprintNode,
  BlueprintNodeType,
  BlueprintAnalysis,
  BlueprintRequirementCandidate,
  BlueprintRequirementCandidateStatus,
  AnalysisResult,
  DiscoveredRequirement,
  WorkspaceSnapshot
} from './types'
import { BLUEPRINT_SCHEMA_VERSION, migrateBlueprint } from '../../../plugins/blueprint/src/main/janus/blueprint-migration'
import { harnessNoteService } from '../harness/service'
import { blueprintNoteView, type ProjectView } from '../blueprint/note-service'
import { remoteBackendRequest, projectRemoteHarnessResult } from '../workspace/remote-harness'
import { parseRuntimeResource, runtimeResource, type WorkspaceRuntime } from '../../shared/workspace-runtime'
import { HARNESS_COMMAND_CHANNELS, type HarnessApplyResult } from '../../shared/ipc/harness'

async function projectView(root: string): Promise<ProjectView> {
  const remote = parseRuntimeResource(root)
  if (!remote) return blueprintNoteView.projectView(root)
  return projectRemoteHarnessResult(await remoteBackendRequest(root, HARNESS_COMMAND_CHANNELS.projectGraph), remote.workspaceId) as ProjectView
}
import {
  applyNodePatch,
  checkWritablePatch,
  createNoteOp,
  nodeTypeToKind,
} from '../harness/artifact-producer'
import { toNoteDoc } from '../notes/note-provider'
import type { BlueprintOperation } from '../../../plugins/blueprint/src/shared/janus/maintenance-types'
import { applyOperations } from '../../../plugins/blueprint/src/main/janus/maintenance/changeset'
import type { OwnerScope } from '../../shared/team/types'
import { checkBaseVersion } from '../../shared/team/repository'

interface WorkspaceIndex {
  blueprints: string[]
  focusedNodeId: string | null
  focusedNodeByWorkspace?: Record<string, string | null>
}

interface WorkspaceRecord {
  id: string
  name: string
  path: string
  runtime?: WorkspaceRuntime
}

/**
 * Project-lane marker (S4). Ids under this prefix are live projections over
 * `.agents/notes`, served by HarnessNoteService. Every content write on this
 * lane goes through the service transaction; legacy JSON ids keep the old
 * lane for old data. No new JSON bypass exists for project flows.
 */
export const PROJECT_GRAPH_PREFIX = 'harness:project:'

export function isProjectGraphId(id: string): boolean {
  return id.startsWith(PROJECT_GRAPH_PREFIX)
}

function harnessThrow(code: 'HARNESS_CONFLICT' | 'HARNESS_MANAGED' | 'HARNESS_READONLY' | 'NOT_FOUND', message: string, path?: string): never {
  throw { code, message, path }
}

function normalizePathKey(path: string): string {
  if (parseRuntimeResource(path)) return path.replace(/\/+$/, '')
  try {
    const out = resolve(path)
    return process.platform === 'win32' ? out.toLowerCase() : out
  } catch {
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
}

function toWorkspaceSnapshot(workspace: WorkspaceRecord): WorkspaceSnapshot {
  return {
    name: workspace.name,
    path: workspace.path
  }
}

export class BlueprintStore {
  private cache = new Map<string, Blueprint>()
  private workspaceRecordsCache: WorkspaceRecord[] | null = null
  private indexCache: WorkspaceIndex | null = null
  private migratedWorkspaces = new Set<string>()
  private mutex = new ReentrantAsyncLock()

  /** 全部公开方法经此锁串行化；可重入，内部互调不会死锁 */
  private locked<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutex.run(operation)
  }

  private async persistBlueprint(id: string, blueprint: Blueprint, semantic = true): Promise<void> {
    if (semantic) blueprint.contentRevision += 1
    await writeJson(blueprintFile(id), blueprint)
  }

  async loadIndex(_workspace?: string): Promise<WorkspaceIndex> {
    return this.locked(async () => {
      if (this.indexCache) return this.indexCache
      const idx = (await readJson<WorkspaceIndex>(indexFile())) ?? {
        blueprints: [],
        focusedNodeId: null,
        focusedNodeByWorkspace: {}
      }
      if (!idx.focusedNodeByWorkspace) idx.focusedNodeByWorkspace = {}
      this.indexCache = idx
      return idx
    })
  }

  private async saveIndex(_workspace?: string): Promise<void> {
    const idx = await this.loadIndex()
    await writeJson(indexFile(), idx)
  }

  private async listWorkspaceRecords(refresh = false): Promise<WorkspaceRecord[]> {
    if (!refresh && this.workspaceRecordsCache) return this.workspaceRecordsCache
    try {
      const files = await fs.readdir(workspacesDir())
      const records: WorkspaceRecord[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const record = await readJson<WorkspaceRecord>(join(workspacesDir(), file))
        if (record?.id && record.name && record.path) records.push(record.runtime && record.runtime.kind !== 'windows'
          ? { ...record, path: runtimeResource(record.id, record.runtime.root) } : record)
      }
      this.workspaceRecordsCache = records
      return records
    } catch {
      return []
    }
  }

  private async findWorkspaceRecord(workspaceIdOrPath: string | null | undefined): Promise<WorkspaceRecord | null> {
    if (!workspaceIdOrPath || workspaceIdOrPath === GLOBAL_BLUEPRINT_SCOPE) return null
    const records = await this.listWorkspaceRecords()
    const byId = records.find((record) => record.id === workspaceIdOrPath)
    if (byId) return byId

    const targetPath = normalizePathKey(workspaceIdOrPath)
    return records.find((record) => normalizePathKey(record.path) === targetPath) ?? null
  }

  private async resolveWorkspaceKey(workspaceIdOrPath: string): Promise<string> {
    const record = await this.findWorkspaceRecord(workspaceIdOrPath)
    return record?.id ?? workspaceIdOrPath
  }

  private async hydrateWorkspaceSnapshot(node: BlueprintNode): Promise<boolean> {
    let changed = false
    if (node.workspaceSnapshot === undefined) {
      node.workspaceSnapshot = null
      changed = true
    }
    if (!node.workspaceId) return changed

    const record = await this.findWorkspaceRecord(node.workspaceId)
    if (!record) return changed

    const nextSnapshot = toWorkspaceSnapshot(record)
    if (node.workspaceSnapshot?.name !== nextSnapshot.name || node.workspaceSnapshot?.path !== nextSnapshot.path) {
      node.workspaceSnapshot = nextSnapshot
      changed = true
    }
    return changed
  }

  private async migrateLegacyWorkspace(workspace: string): Promise<void> {
    if (!workspace || workspace === GLOBAL_BLUEPRINT_SCOPE || this.migratedWorkspaces.has(workspace)) return
    this.migratedWorkspaces.add(workspace)
    const legacy = await readJson<WorkspaceIndex>(legacyIndexFile(workspace))
    if (!legacy?.blueprints?.length) return

    const idx = await this.loadIndex()
    let changed = false
    for (const id of legacy.blueprints) {
      if (idx.blueprints.includes(id)) continue
      const bp = await readJson<Blueprint>(legacyBlueprintFile(workspace, id))
      if (!bp) continue
      if (!Array.isArray(bp.requirementCandidates)) bp.requirementCandidates = []
      for (const nid of Object.keys(bp.nodes)) {
        const n = bp.nodes[nid]
        if (n.lastAnalyzedCommitSha === undefined) n.lastAnalyzedCommitSha = null
        if (n.statusSource === undefined) n.statusSource = 'manual'
        if (n.workspaceId === undefined) n.workspaceId = null
        if (n.workspaceSnapshot === undefined) n.workspaceSnapshot = null
        if (!Array.isArray(n.activities)) n.activities = []
        if (!Array.isArray(n.analyses)) n.analyses = []
        if (!Array.isArray(n.features)) n.features = []
        n.features = n.features.map((feature) => makeFeatureItem(feature))
        await this.hydrateWorkspaceSnapshot(n)
      }
      migrateBlueprint(bp)
      idx.blueprints.push(id)
      this.cache.set(id, bp)
      await this.persistBlueprint(id, bp, false)
      changed = true
    }
    if (changed) await this.saveIndex()
  }

  async listBlueprints(workspace: string): Promise<Blueprint[]> {
    return this.locked(async () => {
      await this.migrateLegacyWorkspace(workspace)
      const idx = await this.loadIndex(workspace)
      const out: Blueprint[] = []
      for (const id of idx.blueprints) {
        const bp = this.cache.get(id) ?? (await this.readBlueprintFile(id))
        if (bp) {
          this.cache.set(id, bp)
          out.push(bp)
        }
      }
      const project = await this.loadProjectGraph(workspace)
      if (project) out.push(project)
      return out
    })
  }

  /**
   * Workspace-only listing (V2): returns exactly the live projection over
   * this checkout's `.agents/notes`, never legacy JSON. Legacy reads stay
   * available on `loadBlueprint`/`listBlueprints` for team/analyzer internals
   * until each workspace migrates; the view layer no longer asks for them.
   */
  async listBlueprintSummaries(workspace: string) {
    return this.locked(async () => {
      const project = await this.loadProjectGraph(workspace)
      if (!project) return []
      return [{
        id: project.id,
        name: project.name,
        description: project.description,
        contentRevision: project.contentRevision,
        nodeCount: project.nodeIds.length,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }]
    })
  }

  private async readBlueprintFile(id: string): Promise<Blueprint | null> {
    const bp = await readJson<Blueprint>(blueprintFile(id))
    if (bp) {
      let changed = false
      if (!Array.isArray(bp.requirementCandidates)) {
        bp.requirementCandidates = []
        changed = true
      }
      // 容错：老节点补齐新增字段
      for (const nid of Object.keys(bp.nodes)) {
        const n = bp.nodes[nid]
        if (n.lastAnalyzedCommitSha === undefined) {
          n.lastAnalyzedCommitSha = null
          changed = true
        }
        if (n.statusSource === undefined) {
          n.statusSource = 'manual'
          changed = true
        }
        if (n.workspaceId === undefined) {
          n.workspaceId = null
          changed = true
        }
        if (n.workspaceSnapshot === undefined) {
          n.workspaceSnapshot = null
          changed = true
        }
        if (!Array.isArray(n.activities)) {
          n.activities = []
          changed = true
        }
        if (!Array.isArray(n.analyses)) {
          n.analyses = []
          changed = true
        }
        if (!Array.isArray(n.features)) {
          n.features = []
          changed = true
        }
        n.features = n.features.map((feature) => makeFeatureItem(feature))
        changed = (await this.hydrateWorkspaceSnapshot(n)) || changed
      }
      changed = migrateBlueprint(bp) || changed
      if (changed) await writeJson(blueprintFile(id), bp)
    }
    return bp
  }

  /** Drops one id from the in-memory cache; file moves go through here after archiving. */
  evictBlueprint(id: string): void {
    this.cache.delete(id)
  }

  async loadBlueprint(...args: [workspace: string, id: string]): Promise<Blueprint | null> {    return this.locked(async () => {
      // Keep the workspace-first public contract; persisted blueprint files are keyed globally by id.
      const id = args[1]
      if (isProjectGraphId(id)) return this.loadProjectGraph(args[0], id)
      const cached = this.cache.get(id)
      if (cached) return cached
      const bp = await this.readBlueprintFile(id)
      if (bp) this.cache.set(id, bp)
      return bp
    })
  }

  /** Fresh projection per call; the service owns revision caching. Never stored in the JSON cache. */
  private async loadProjectGraph(workspace: string, onlyId?: string): Promise<Blueprint | null> {
    if (parseRuntimeResource(workspace)) {
      const view = await projectView(workspace)
      return onlyId && view.blueprint.id !== onlyId ? null : view.blueprint
    }
    const resolved = await harnessNoteService.resolveRoot(workspace)
    if (!resolved.ok || !resolved.root) return null
    const view = await blueprintNoteView.projectView(resolved.root)
    if (onlyId && view.blueprint.id !== onlyId) return null
    return view.blueprint
  }

  private async projectRoot(workspace: string, blueprintId: string): Promise<string> {
    if (parseRuntimeResource(workspace)) {
      if ((await projectView(workspace)).blueprint.id !== blueprintId) harnessThrow('NOT_FOUND', `unknown project graph: ${blueprintId}`)
      return workspace
    }
    const resolved = await harnessNoteService.resolveRoot(workspace)
    if (!resolved.ok || !resolved.root) harnessThrow('NOT_FOUND', `no project notes under ${workspace}`)
    const view = await blueprintNoteView.projectView(resolved.root as string)
    if (view.blueprint.id !== blueprintId) harnessThrow('NOT_FOUND', `unknown project graph: ${blueprintId}`)
    return resolved.root as string
  }

  async applyMaintenanceOperations(
    blueprintId: string,
    expectedRevision: number,
    operations: BlueprintOperation[],
    allowedNodeIds: Set<string>
  ): Promise<{ before: Blueprint; after: Blueprint; createdNodeIds: Record<string, string>; createdRelationIds: Record<string, string> }> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'project notes change through the harness transaction, not legacy operations', blueprintId)
    }
    return this.locked(async () => {
      const current = await this.loadBlueprint(GLOBAL_BLUEPRINT_SCOPE, blueprintId)
      if (!current) throw new Error('目标蓝图不存在')
      if (current.contentRevision !== expectedRevision) {
        throw new Error(`蓝图版本已变化：期望 ${expectedRevision}，当前 ${current.contentRevision}`)
      }
      const before = structuredClone(current)
      const { blueprint: after, createdNodeIds, createdRelationIds } =
        applyOperations(current, operations, new Set(allowedNodeIds))
      await writeJson(blueprintFile(blueprintId), after)
      this.cache.set(blueprintId, after)
      return { before, after, createdNodeIds, createdRelationIds }
    })
  }

  async createBlueprint(
    workspace: string,
    input: { name: string; description?: string; rootTitle?: string; rootType?: BlueprintNodeType; ownership?: { ownerScope?: OwnerScope; tenantId?: string | null; projectId?: string | null; ownerUserId?: string | null; updatedBy?: string | null } }
  ): Promise<Blueprint> {
    return this.locked(async () => {
      const id = randomUUID()
      const ts = nowIso()
      const root = makeNode({
        title: input.rootTitle ?? input.name,
        type: input.rootType ?? 'epic'
      })
      const bp: Blueprint = {
        schemaVersion: BLUEPRINT_SCHEMA_VERSION,
        contentRevision: 0,
        id,
        name: input.name,
        description: input.description ?? '',
        ownerScope: input.ownership?.ownerScope ?? 'private',
        tenantId: input.ownership?.tenantId ?? null,
        projectId: input.ownership?.projectId ?? null,
        ownerUserId: input.ownership?.ownerUserId ?? null,
        updatedBy: input.ownership?.updatedBy ?? null,
        rootNodeId: root.id,
        nodeIds: [root.id],
        nodes: { [root.id]: root },
        relations: [],
        requirementCandidates: [],
        mountedTo: null,
        canvasLayout: {},
        collapsedNodeIds: null,
        createdAt: ts,
        updatedAt: ts
      }
      this.cache.set(id, bp)
      const idx = await this.loadIndex(workspace)
      idx.blueprints.push(id)
      await this.saveIndex(workspace)
      await this.persistBlueprint(id, bp, false)
      return bp
    })
  }

  async updateBlueprint(
    workspace: string,
    id: string,
    patch: Partial<Pick<Blueprint, 'name' | 'description' | 'canvasLayout' | 'collapsedNodeIds' | 'ownerScope' | 'tenantId' | 'projectId' | 'ownerUserId' | 'updatedBy'>> & { baseVersion?: number }
  ): Promise<Blueprint | null> {
    return this.locked(async () => {
      if (isProjectGraphId(id)) return this.updateProjectGraph(workspace, id, patch)
      const bp = await this.loadBlueprint(workspace, id)
      if (!bp) return null
      // ToB M1 乐观并发：baseVersion 缺省沿用单机行为；传入则必须与 contentRevision 一致。
      checkBaseVersion(bp.contentRevision, patch.baseVersion)
      if (patch.name !== undefined) bp.name = patch.name
      if (patch.description !== undefined) bp.description = patch.description
      if (patch.canvasLayout !== undefined) bp.canvasLayout = patch.canvasLayout
      if (patch.collapsedNodeIds !== undefined) {
        bp.collapsedNodeIds = patch.collapsedNodeIds === null
          ? null
          : [...new Set(patch.collapsedNodeIds.filter((id) => typeof id === 'string' && bp.nodes[id]))]
      }
      bp.updatedAt = nowIso()
      const ownershipChanged = patch.ownerScope !== undefined || patch.tenantId !== undefined
        || patch.projectId !== undefined || patch.ownerUserId !== undefined || patch.updatedBy !== undefined
      if (patch.ownerScope !== undefined) bp.ownerScope = patch.ownerScope
      if (patch.tenantId !== undefined) bp.tenantId = patch.tenantId
      if (patch.projectId !== undefined) bp.projectId = patch.projectId
      if (patch.ownerUserId !== undefined) bp.ownerUserId = patch.ownerUserId
      if (patch.updatedBy !== undefined) bp.updatedBy = patch.updatedBy
      await this.persistBlueprint(id, bp, patch.name !== undefined || patch.description !== undefined || ownershipChanged)
      return bp
    })
  }

  /** Project lane: canvas overlay goes local-only; shared metadata stays read-only. */
  private async updateProjectGraph(
    workspace: string,
    id: string,
    patch: Partial<Pick<Blueprint, 'name' | 'description' | 'canvasLayout' | 'collapsedNodeIds' | 'ownerScope' | 'tenantId' | 'projectId' | 'ownerUserId' | 'updatedBy'>> & { baseVersion?: number }
  ): Promise<Blueprint | null> {
    const root = await this.projectRoot(workspace, id)
    const rest = { ...patch } as Record<string, unknown>
    delete rest.baseVersion
    const uiKeys = ['canvasLayout', 'collapsedNodeIds'] as const
    const sharedKeys = Object.keys(rest).filter((k) => !(uiKeys as readonly string[]).includes(k))
    if (sharedKeys.length > 0) {
      harnessThrow('HARNESS_READONLY', `project graph metadata is read-only: ${sharedKeys.join(', ')}`)
    }
    if (patch.canvasLayout !== undefined || patch.collapsedNodeIds !== undefined) {
      const ui = {
        canvasLayout: patch.canvasLayout,
        collapsedNodeIds: patch.collapsedNodeIds ?? undefined,
      }
      if (parseRuntimeResource(root)) await remoteBackendRequest(root, 'blueprint.ui.save', [ui])
      else await blueprintNoteView.saveUiState(root, ui)
    }
    return this.loadProjectGraph(workspace, id)
  }

  async deleteBlueprint(workspace: string, id: string): Promise<boolean> {
    if (isProjectGraphId(id)) return false
    return this.locked(async () => {
      const existed = this.cache.has(id) || (await readJson<Blueprint>(blueprintFile(id))) !== null
      this.cache.delete(id)
      const idx = await this.loadIndex(workspace)
      idx.blueprints = idx.blueprints.filter((b) => b !== id)
      if (idx.focusedNodeId) {
        const stillExists = await this.nodeExistsInIndex(workspace, idx.focusedNodeId)
        if (!stillExists) idx.focusedNodeId = null
      }
      for (const [ws, nodeId] of Object.entries(idx.focusedNodeByWorkspace ?? {})) {
        if (!nodeId) continue
        const stillExists = await this.nodeExistsInIndex(workspace, nodeId)
        if (!stillExists) idx.focusedNodeByWorkspace![ws] = null
      }
      await this.saveIndex(workspace)
      try {
        await fs.unlink(blueprintFile(id))
      } catch {
        /* 文件可能不存在 */
      }
      return existed
    })
  }

  private async nodeExistsInIndex(workspace: string, nodeId: string): Promise<boolean> {
    const idx = await this.loadIndex(workspace)
    for (const bid of idx.blueprints) {
      const bp = await this.loadBlueprint(workspace, bid)
      if (bp && bp.nodes[nodeId]) return true
    }
    return false
  }

  async createNode(
    workspace: string,
    blueprintId: string,
    input: Partial<BlueprintNode> & { title: string; type: BlueprintNodeType },
    parentId: string | null = null
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      return this.locked(() => this.createProjectNode(workspace, blueprintId, input, parentId))
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp) return null
      const node = makeNode({ ...input, parentId })
      await this.hydrateWorkspaceSnapshot(node)
      bp.nodes[node.id] = node
      bp.nodeIds.push(node.id)
      if (parentId && bp.nodes[parentId]) {
        bp.nodes[parentId].children.push(node.id)
        bp.nodes[parentId].updatedAt = nowIso()
      }
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  /** Project lane: canvas creates become draft notes through the service transaction. */
  private async createProjectNode(
    workspace: string,
    blueprintId: string,
    input: Partial<BlueprintNode> & { title: string; type: BlueprintNodeType },
    parentId: string | null,
  ): Promise<BlueprintNode | null> {
    const root = await this.projectRoot(workspace, blueprintId)
    const view = await projectView(root)
    if (!view.repoId) harnessThrow('NOT_FOUND', 'init .agents/harness.json with a repoId first')
    if (!input.title.trim()) return null
    let parentUri: string | null = null
    if (parentId) {
      const parent = view.blueprint.nodes[parentId]
      if (!parent?.sourceUri) return null
      parentUri = parent.sourceUri
    }
    const kind = nodeTypeToKind(input.type)
    if (parseRuntimeResource(root)) {
      const result = await remoteBackendRequest<HarnessApplyResult>(root, HARNESS_COMMAND_CHANNELS.apply,
        [[{ kind: 'create', nodeType: input.type, title: input.title.trim(), parentUri }], 'canvas create'])
      const fresh = await projectView(root)
      return fresh.blueprint.nodes[result.applied[0]?.uri.split('/').pop() ?? ''] ?? null
    }
    const created = createNoteOp(view.repoId as string, kind, input.title.trim(), parentUri, 'canvas create')
    await harnessNoteService.applyOperations(root, [{ ...created }], 'canvas create')
    const fresh = await projectView(root)
    const id = created.uri.split('/').pop() as string
    return fresh.blueprint.nodes[id] ?? null
  }

  async updateNode(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    patch: Partial<BlueprintNode>
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      return this.locked(() => this.updateProjectNode(workspace, blueprintId, nodeId, patch))
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      // 不允许通过通用 patch 覆盖只读字段
      const { id: _id, createdAt: _c, ...safe } = patch
      if (safe.workspaceId !== undefined && safe.primaryWorkspaceId === undefined) {
        safe.primaryWorkspaceId = safe.workspaceId || null
      }
      if (safe.primaryWorkspaceId !== undefined) {
        safe.workspaceId = safe.primaryWorkspaceId
        if (safe.linkedWorkspaceIds === undefined) {
          safe.linkedWorkspaceIds = (node.linkedWorkspaceIds ?? [])
            .filter((id) => id !== safe.primaryWorkspaceId)
        }
      }
      if (safe.linkedWorkspaceIds !== undefined) {
        const primary = safe.primaryWorkspaceId !== undefined ? safe.primaryWorkspaceId : node.primaryWorkspaceId
        safe.linkedWorkspaceIds = safe.linkedWorkspaceIds
          .filter((id, index, ids) => id !== primary && ids.indexOf(id) === index)
      }
      if (safe.workspaceId !== undefined) {
        if (!safe.workspaceId) {
          safe.workspaceId = null
          safe.workspaceSnapshot = null
        } else if (safe.workspaceSnapshot === undefined) {
          const record = await this.findWorkspaceRecord(safe.workspaceId)
          safe.workspaceSnapshot = record ? toWorkspaceSnapshot(record) : node.workspaceSnapshot ?? null
        }
      }
      if (safe.parentId !== undefined && safe.parentId !== node.parentId) {
        const nextParentId = safe.parentId
        if (nodeId === bp.rootNodeId && nextParentId) return null
        if (nextParentId === nodeId) return null
        if (nextParentId && !bp.nodes[nextParentId]) return null
        const isDescendant = (candidateId: string, ancestorId: string): boolean => {
          let cursor = bp.nodes[candidateId]?.parentId ?? null
          while (cursor) {
            if (cursor === ancestorId) return true
            cursor = bp.nodes[cursor]?.parentId ?? null
          }
          return false
        }
        if (nextParentId && isDescendant(nextParentId, nodeId)) return null
        const oldParent = node.parentId ? bp.nodes[node.parentId] : null
        if (oldParent) {
          oldParent.children = oldParent.children.filter((id) => id !== nodeId)
          oldParent.updatedAt = nowIso()
        }
        const nextParent = nextParentId ? bp.nodes[nextParentId] : null
        if (nextParent && !nextParent.children.includes(nodeId)) {
          nextParent.children.push(nodeId)
          nextParent.updatedAt = nowIso()
        }
      }
      Object.assign(node, safe)
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  /** Project lane: canvas field edits become replace ops with optimistic file hashes. */
  private async updateProjectNode(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    patch: Partial<BlueprintNode>,
  ): Promise<BlueprintNode | null> {
    const root = await this.projectRoot(workspace, blueprintId)
    const view = await projectView(root)
    const node = view.blueprint.nodes[nodeId]
    if (!node?.sourceUri || !node.sourceHash) return null
    // Optimistic concurrency: the caller's last-seen hash wins over a fresh
    // read, so stale canvases conflict instead of silently overwriting.
    const { sourceHash: _seen, sourceUri: _uri, sourceRelPath: _rel, ...fields } = patch
    const expectedHash = _seen ?? node.sourceHash
    const managed = checkWritablePatch(fields as Record<string, unknown>)
    if (managed) harnessThrow('HARNESS_MANAGED', managed.message, nodeId)
    if (parseRuntimeResource(root)) {
      let parentUri: string | null | undefined
      if (fields.parentId !== undefined) {
        if (fields.parentId === nodeId) return null
        parentUri = fields.parentId === null ? null : view.blueprint.nodes[fields.parentId]?.sourceUri
        if (fields.parentId && !parentUri) return null
      }
      await remoteBackendRequest(root, HARNESS_COMMAND_CHANNELS.apply,
        [[{ kind: 'update', uri: node.sourceUri, expectedHash, patch: { ...fields, ...(parentUri !== undefined ? { parentUri } : {}) } }], 'canvas edit'])
      return (await projectView(root)).blueprint.nodes[nodeId] ?? null
    }
    const current = await harnessNoteService.readNote(root, nodeId)
    let parentUri: string | null | undefined
    if (fields.parentId !== undefined) {
      if (fields.parentId === nodeId) return null
      if (fields.parentId === null) {
        parentUri = null
      } else {
        const parent = view.blueprint.nodes[fields.parentId]
        if (!parent?.sourceUri) return null
        parentUri = parent.sourceUri
      }
    }
    const produced = applyNodePatch(toNoteDoc(current.note), {
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.positioning !== undefined ? { positioning: fields.positioning } : {}),
      ...(fields.techSolution !== undefined ? { techSolution: fields.techSolution } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.tags !== undefined ? { tags: fields.tags } : {}),
      ...(parentUri !== undefined ? { parentUri } : {}),
    })
    if (!('edit' in produced)) {
      if (produced.code === 'HARNESS_MANAGED') harnessThrow('HARNESS_MANAGED', produced.message, nodeId)
      harnessThrow('NOT_FOUND', produced.message, nodeId)
    }
    const markdown = harnessNoteService.mergeNoteEdit(current.note, current.raw, produced.edit, 'canvas edit')
    await harnessNoteService.applyOperations(
      root,
      [{
        operationId: `replace-${nodeId.slice(0, 8)}`,
        type: 'replace',
        uri: node.sourceUri,
        expectedHash,
        afterMarkdown: markdown,
      }],
      'canvas edit',
    )
    const fresh = await projectView(root)
    return fresh.blueprint.nodes[nodeId] ?? null
  }

  /** Project lane: canvas deletes archive the note; true removal stays destructive-scope. */
  private async archiveProjectNode(workspace: string, blueprintId: string, nodeId: string): Promise<boolean> {
    const root = await this.projectRoot(workspace, blueprintId)
    const view = await projectView(root)
    const node = view.blueprint.nodes[nodeId]
    if (!node?.sourceUri || !node.sourceHash) return false
    if (parseRuntimeResource(root)) {
      await remoteBackendRequest(root, HARNESS_COMMAND_CHANNELS.apply,
        [[{ kind: 'archive', uri: node.sourceUri, expectedHash: node.sourceHash, reason: 'archived from canvas' }], 'archived from canvas'])
      return true
    }
    const current = await harnessNoteService.readNote(root, nodeId)
    const markdown = harnessNoteService.mergeNoteEdit(
      current.note,
      current.raw,
      { sections: {}, frontmatter: { lifecycle: 'archived' } },
      'archived from canvas',
    )
    await harnessNoteService.applyOperations(
      root,
      [{
        operationId: `archive-${nodeId.slice(0, 8)}`,
        type: 'replace',
        uri: node.sourceUri,
        expectedHash: node.sourceHash,
        afterMarkdown: markdown,
      }],
      'archived from canvas',
    )
    return true
  }

  async patchNodeFeatures(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    features: Array<Partial<BlueprintFeatureItem> & { title: string }>
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'acceptance clauses on project notes are managed by maintenance flows', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      node.features = features.map((feature) => makeFeatureItem(feature))
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async appendNodeFeature(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    feature: Partial<BlueprintFeatureItem> & { title: string }
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'acceptance clauses on project notes are managed by maintenance flows', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      node.features = [...(node.features ?? []), makeFeatureItem(feature)]
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async updateNodeFeature(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    featureId: string,
    patch: Partial<BlueprintFeatureItem>
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'acceptance clauses on project notes are managed by maintenance flows', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      const feature = (node.features ?? []).find((item) => item.id === featureId)
      if (!feature) return null
      if (patch.title !== undefined) feature.title = patch.title
      if (patch.description !== undefined) feature.description = patch.description
      if (patch.progress !== undefined) feature.progress = Math.max(0, Math.min(100, patch.progress))
      if (patch.status !== undefined) feature.status = normalizeFeatureStatus(patch.status)
      if (patch.requirementNotes !== undefined) feature.requirementNotes = [...patch.requirementNotes]
      feature.updatedAt = nowIso()
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async deleteNodeFeature(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    featureId: string
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'acceptance clauses on project notes are managed by maintenance flows', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      node.features = (node.features ?? []).filter((item) => item.id !== featureId)
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async deleteNode(workspace: string, blueprintId: string, nodeId: string): Promise<boolean> {
    if (isProjectGraphId(blueprintId)) {
      return this.locked(() => this.archiveProjectNode(workspace, blueprintId, nodeId))
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return false
      if (bp.nodeIds.length <= 1) return false
      const node = bp.nodes[nodeId]
      // 重新挂载子节点到父节点
      const parent = node.parentId ? bp.nodes[node.parentId] : null
      for (const childId of node.children) {
        const child = bp.nodes[childId]
        if (child) {
          child.parentId = node.parentId
          if (parent && !parent.children.includes(childId)) parent.children.push(childId)
        }
      }
      if (parent) {
        parent.children = parent.children.filter((c) => c !== nodeId)
      }
      delete bp.nodes[nodeId]
      bp.nodeIds = bp.nodeIds.filter((n) => n !== nodeId)
      if (Array.isArray(bp.collapsedNodeIds)) {
        bp.collapsedNodeIds = bp.collapsedNodeIds.filter((id) => id !== nodeId)
      }
      bp.relations = (bp.relations ?? []).filter(
        (relation) => relation.sourceNodeId !== nodeId && relation.targetNodeId !== nodeId
      )
      delete bp.canvasLayout[nodeId]
      if (bp.rootNodeId === nodeId) {
        const promoted =
          node.children.find((childId) => bp.nodes[childId]) ??
          bp.nodeIds.find((id) => bp.nodes[id]?.parentId === null) ??
          bp.nodeIds[0]
        if (!promoted) return false
        bp.rootNodeId = promoted
        bp.nodes[promoted].parentId = null
      }
      bp.updatedAt = nowIso()
      const idx = await this.loadIndex(workspace)
      if (idx.focusedNodeId === nodeId) {
        idx.focusedNodeId = null
      }
      for (const [ws, focused] of Object.entries(idx.focusedNodeByWorkspace ?? {})) {
        if (focused === nodeId) idx.focusedNodeByWorkspace![ws] = null
      }
      await this.saveIndex(workspace)
      await this.persistBlueprint(blueprintId, bp)
      return true
    })
  }

  /** 追加分析记录并按成功与否回写状态字段 */
  async appendAnalysis(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    analysis: BlueprintAnalysis
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'analysis records on project graphs stay in analyzer run records; adopt conclusions through the maintenance flow, not legacy writes', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      node.analyses.push(analysis)
      node.activities.push({
        id: randomUUID(),
        type: 'analysis',
        content: analysis.result?.summary ?? analysis.error ?? '分析完成',
        metadata: { analysisId: analysis.id, applied: analysis.applied },
        createdAt: analysis.createdAt
      })
      if (analysis.applied && analysis.result) {
        const r: AnalysisResult = analysis.result
        node.progress = r.progress
        node.status = r.status
        node.statusSource = 'janus'
        for (const update of r.featureUpdates ?? []) {
          const feature = (node.features ?? []).find((item) => item.id === update.featureId)
          if (!feature) continue
          if (update.progress !== undefined) feature.progress = Math.max(0, Math.min(100, update.progress))
          if (update.status !== undefined) feature.status = normalizeFeatureStatus(update.status)
          if (update.description !== undefined) feature.description = update.description
          if (update.requirementNotes !== undefined) feature.requirementNotes = [...update.requirementNotes]
          feature.updatedAt = nowIso()
        }
      }
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async applyAnalysisPatch(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    patch: {
      progress?: number
      status?: BlueprintNode['status']
      featureUpdates?: Array<{
        featureId: string
        progress?: number
        status?: BlueprintFeatureStatus
        description?: string
        requirementNotes?: string[]
      }>
    }
  ): Promise<BlueprintNode | null> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'analysis patches on project graphs are managed by the maintenance flow, not legacy writes', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      if (patch.progress !== undefined) {
        node.progress = Math.max(0, Math.min(100, patch.progress))
        node.statusSource = 'janus'
      }
      if (patch.status !== undefined) {
        node.status = patch.status
        node.statusSource = 'janus'
      }
      for (const update of patch.featureUpdates ?? []) {
        const feature = (node.features ?? []).find((item) => item.id === update.featureId)
        if (!feature) continue
        if (update.progress !== undefined) feature.progress = Math.max(0, Math.min(100, update.progress))
        if (update.status !== undefined) feature.status = normalizeFeatureStatus(update.status)
        if (update.description !== undefined) feature.description = update.description
        if (update.requirementNotes !== undefined) feature.requirementNotes = [...update.requirementNotes]
        feature.updatedAt = nowIso()
      }
      node.updatedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async upsertRequirementCandidates(
    workspace: string,
    blueprintId: string,
    sourceNodeId: string,
    sourceAnalysisId: string,
    requirements: DiscoveredRequirement[],
    evidence: string[] = []
  ): Promise<BlueprintRequirementCandidate[]> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'requirement candidates on project graphs become requirement notes through the maintenance flow, not legacy lists', sourceNodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[sourceNodeId]) return []

      bp.requirementCandidates ??= []
      const touched: BlueprintRequirementCandidate[] = []
      let changed = false
      const now = nowIso()

      for (const requirement of requirements) {
        const title = requirement.title.trim()
        if (!title) continue

        const description = requirement.description?.trim() ?? ''
        const suggestedParentTitle = requirement.suggestedParent?.trim() || undefined
        const key = candidateKey(sourceNodeId, title, description, suggestedParentTitle)
        const existing = bp.requirementCandidates.find((candidate) =>
          candidateKey(candidate.sourceNodeId, candidate.title, candidate.description, candidate.suggestedParentTitle) === key
        )

        if (existing) {
          if (existing.status !== 'pending') continue
          existing.sourceAnalysisId = sourceAnalysisId
          existing.confidence = Math.max(existing.confidence, requirement.confidence)
          existing.suggestedParentId = existing.suggestedParentId ?? resolveSuggestedParentId(bp, suggestedParentTitle)
          existing.suggestedParentTitle = existing.suggestedParentTitle ?? suggestedParentTitle
          existing.evidence = Array.from(new Set([...(existing.evidence ?? []), ...evidence]))
          touched.push(existing)
          changed = true
          continue
        }

        const candidate: BlueprintRequirementCandidate = {
          id: randomUUID(),
          blueprintId,
          sourceNodeId,
          sourceAnalysisId,
          title,
          description,
          suggestedParentId: resolveSuggestedParentId(bp, suggestedParentTitle),
          suggestedParentTitle,
          confidence: requirement.confidence,
          status: 'pending',
          evidence: [...evidence],
          createdAt: now
        }
        bp.requirementCandidates.push(candidate)
        touched.push(candidate)
        changed = true
      }

      if (changed) {
        bp.updatedAt = nowIso()
        await this.persistBlueprint(blueprintId, bp)
      }

      return touched
    })
  }

  async listRequirementCandidates(
    workspace: string,
    blueprintId: string,
    status?: BlueprintRequirementCandidateStatus
  ): Promise<BlueprintRequirementCandidate[]> {
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp) return []
      const candidates = bp.requirementCandidates ?? []
      return candidates
        .filter((candidate) => !status || candidate.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })
  }

  async acceptRequirementCandidate(
    workspace: string,
    blueprintId: string,
    candidateId: string,
    patch: {
      title?: string
      description?: string
      parentId?: string
      decisionNote?: string
    } = {}
  ): Promise<BlueprintNode | null> {
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp) return null
      bp.requirementCandidates ??= []

      const candidate = bp.requirementCandidates.find((item) => item.id === candidateId)
      if (!candidate) return null
      if (candidate.status === 'accepted' && candidate.acceptedNodeId) {
        return bp.nodes[candidate.acceptedNodeId] ?? null
      }

      const title = patch.title?.trim() || candidate.title
      const description = patch.description !== undefined ? patch.description : candidate.description
      let parentId = patch.parentId ?? candidate.suggestedParentId ?? null
      if (!parentId || !bp.nodes[parentId]) parentId = candidate.sourceNodeId
      if (!bp.nodes[parentId]) parentId = bp.rootNodeId

      const sourceNode = bp.nodes[candidate.sourceNodeId]
      const node = makeNode({
        title,
        type: 'task',
        description,
        status: 'not-started',
        progress: 0,
        tags: ['discovered-by-janus'],
        parentId,
        workspaceId: sourceNode?.workspaceId ?? null,
        workspaceSnapshot: sourceNode?.workspaceSnapshot ?? null
      })
      await this.hydrateWorkspaceSnapshot(node)

      bp.nodes[node.id] = node
      bp.nodeIds.push(node.id)
      bp.nodes[parentId].children.push(node.id)
      bp.nodes[parentId].updatedAt = nowIso()

      candidate.title = title
      candidate.description = description
      candidate.suggestedParentId = parentId
      candidate.suggestedParentTitle = bp.nodes[parentId].title
      candidate.status = 'accepted'
      candidate.acceptedNodeId = node.id
      candidate.decisionNote = patch.decisionNote
      candidate.decidedAt = nowIso()

      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return node
    })
  }

  async rejectRequirementCandidate(
    workspace: string,
    blueprintId: string,
    candidateId: string,
    decisionNote?: string
  ): Promise<BlueprintRequirementCandidate | null> {
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp) return null
      bp.requirementCandidates ??= []

      const candidate = bp.requirementCandidates.find((item) => item.id === candidateId)
      if (!candidate) return null

      candidate.status = 'rejected'
      candidate.decisionNote = decisionNote
      candidate.decidedAt = nowIso()
      bp.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
      return candidate
    })
  }

  async listAnalyses(
    workspace: string,
    blueprintId: string,
    nodeId: string
  ): Promise<BlueprintAnalysis[]> {
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return []
      return [...(bp.nodes[nodeId].analyses ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })
  }

  async applyAnalysis(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    analysisId: string
  ): Promise<BlueprintNode | null> {
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return null
      const node = bp.nodes[nodeId]
      const analysis = (node.analyses ?? []).find((item) => item.id === analysisId)
      if (!analysis?.applied || !analysis.result) return null

      const updated = await this.applyAnalysisPatch(workspace, blueprintId, nodeId, {
        progress: analysis.result.progress,
        status: analysis.result.status,
        featureUpdates: analysis.result.featureUpdates
      })
      if (!updated) return null

      const latest = await this.loadBlueprint(workspace, blueprintId)
      const latestNode = latest?.nodes[nodeId]
      if (!latest || !latestNode) return updated
      latestNode.activities.push({
        id: randomUUID(),
        type: 'analysis',
        content: `重新应用分析：${analysis.result.summary || analysis.id}`,
        metadata: { analysisId: analysis.id, reapplied: true },
        createdAt: nowIso()
      })
      latestNode.updatedAt = nowIso()
      latest.updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, latest)
      return latestNode
    })
  }

  /** 更新分析游标 */
  async setCursor(
    workspace: string,
    blueprintId: string,
    nodeId: string,
    sha: string | null
  ): Promise<void> {
    if (isProjectGraphId(blueprintId)) {
      harnessThrow('HARNESS_MANAGED', 'analyzer cursors on project graphs are not persisted; analysis rescans within its commit budget', nodeId)
    }
    return this.locked(async () => {
      const bp = await this.loadBlueprint(workspace, blueprintId)
      if (!bp || !bp.nodes[nodeId]) return
      bp.nodes[nodeId].lastAnalyzedCommitSha = sha
      bp.nodes[nodeId].updatedAt = nowIso()
      await this.persistBlueprint(blueprintId, bp)
    })
  }

  /** 焦点节点（归属机制 B） */
  async getFocusedNodeId(workspace: string): Promise<string | null> {
    return this.locked(async () => {
      const idx = await this.loadIndex(workspace)
      const key = await this.resolveWorkspaceKey(workspace)
      const focused = idx.focusedNodeByWorkspace?.[key] ?? idx.focusedNodeByWorkspace?.[workspace] ?? idx.focusedNodeId
      if (focused && key !== workspace && idx.focusedNodeByWorkspace?.[workspace] === focused && idx.focusedNodeByWorkspace[key] !== focused) {
        idx.focusedNodeByWorkspace[key] = focused
        delete idx.focusedNodeByWorkspace[workspace]
        await this.saveIndex(workspace)
      }
      return focused ?? null
    })
  }

  async setFocusedNodeId(workspace: string, nodeId: string | null): Promise<void> {
    return this.locked(async () => {
      const idx = await this.loadIndex(workspace)
      idx.focusedNodeByWorkspace ??= {}
      const key = await this.resolveWorkspaceKey(workspace)
      idx.focusedNodeByWorkspace[key] = nodeId
      if (key !== workspace) delete idx.focusedNodeByWorkspace[workspace]
      await this.saveIndex(workspace)
    })
  }

  async focusNode(workspace: string, nodeId: string): Promise<BlueprintNode | null> {
    return this.locked(async () => {
      const found = await this.findNode(workspace, nodeId)
      if (!found) return null
      await this.setFocusedNodeId(found.node.workspaceId ?? workspace, nodeId)
      return found.node
    })
  }

  async bindTerminal(
    workspace: string,
    nodeId: string,
    terminalId: string
  ): Promise<BlueprintNode | null> {
    return this.locked(async () => {
      const found = await this.findNode(workspace, nodeId)
      if (!found) return null
      const { blueprintId } = found
      const node = await this.updateNode(workspace, blueprintId, nodeId, {
        boundTerminalId: terminalId
      })
      if (node) {
        node.terminalHistory = [...node.terminalHistory, terminalId]
        await this.updateNode(workspace, blueprintId, nodeId, { terminalHistory: node.terminalHistory })
      }
      await this.setFocusedNodeId(node?.workspaceId ?? workspace, nodeId)
      return node
    })
  }

  /** 在某 workspace 的所有蓝图里查找节点 */
  async findNode(
    workspace: string,
    nodeId: string
  ): Promise<{ blueprintId: string; node: BlueprintNode } | null> {
    return this.locked(async () => {
      const idx = await this.loadIndex(workspace)
      for (const bid of idx.blueprints) {
        const bp = await this.loadBlueprint(workspace, bid)
        if (bp && bp.nodes[nodeId]) {
          return { blueprintId: bid, node: bp.nodes[nodeId] }
        }
      }
      return null
    })
  }

  /** 取某 workspace 当前焦点节点（含所属 blueprint） */
  async findFocusedNode(
    workspace: string
  ): Promise<{ blueprintId: string; node: BlueprintNode } | null> {
    return this.locked(async () => {
      const fid = await this.getFocusedNodeId(workspace)
      if (!fid) return null
      return this.findNode(workspace, fid)
    })
  }

  /** 依据 terminalId 反查绑定节点（终端关闭最终分析用） */
  async findNodeByTerminal(
    workspace: string,
    terminalId: string
  ): Promise<{ blueprintId: string; node: BlueprintNode } | null> {
    return this.locked(async () => {
      const idx = await this.loadIndex(workspace)
      for (const bid of idx.blueprints) {
        const bp = await this.loadBlueprint(workspace, bid)
        if (!bp) continue
        for (const n of Object.values(bp.nodes)) {
          if (n.boundTerminalId === terminalId) {
            return { blueprintId: bid, node: n }
          }
        }
      }
      return null
    })
  }
}

export const blueprintStore = new BlueprintStore()
