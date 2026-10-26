/**
 * @file 共享资源 Repository 契约（ToB M1）
 * @description Blueprint / Knowledge 的存储抽象与团队策略纯函数。
 *              Local 实现委托现有单机存储（M1 只落地 Blueprint，Knowledge 随 M4 共享接）；
 *              服务端实现后续挂同一接口，调用方（IPC / UI）不改。
 *              版本语义：Blueprint 用 contentRevision，Knowledge 真相实体用各自 version。
 */

import type { Blueprint } from '../../../plugins/blueprint/src/shared/janus/types'
import type { OwnerScope } from './types'

/** 乐观并发冲突：远端已被他人改写，本次写入必须放弃，不得覆盖。 */
export class VersionConflictError extends Error {
  readonly currentVersion: number
  readonly baseVersion: number

  constructor(currentVersion: number, baseVersion: number) {
    super(`版本冲突：写入基线 ${baseVersion}，当前已是 ${currentVersion}，请先同步再试`)
    this.name = 'VersionConflictError'
    this.currentVersion = currentVersion
    this.baseVersion = baseVersion
  }
}

/**
 * 写入前校验基线版本。baseVersion 缺省表示调用方不做并发控制（沿用单机行为）。
 * @throws {VersionConflictError} 基线与当前不一致时抛出，调用方不得落盘。
 */
export function checkBaseVersion(currentVersion: number, baseVersion?: number): void {
  if (baseVersion === undefined) return
  if (currentVersion !== baseVersion) throw new VersionConflictError(currentVersion, baseVersion)
}

/** 归属快照（Blueprint / Knowledge 真相实体均满足该结构子集）。 */
export interface OwnershipRef {
  ownerScope?: OwnerScope
  tenantId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
}

/** 发起访问的身份（由会话的 userId + activeTenant 上下文构成）。 */
export interface ViewerRef {
  userId: string
  tenantId?: string | null
  projectId?: string | null
}

/**
 * 可见性判定：
 * - 本人永远可见；无 ownerUserId 的历史数据视为单机老数据，对所有人可见；
 * - private 他人不可见；project 需同组织（且同项目，若资源限定了项目）。
 */
export function isResourceVisibleTo(resource: OwnershipRef, viewer: ViewerRef): boolean {
  if (!resource.ownerUserId || resource.ownerUserId === viewer.userId) return true
  if ((resource.ownerScope ?? 'private') === 'private') return false
  if (!resource.tenantId || resource.tenantId !== viewer.tenantId) return false
  if (resource.projectId && resource.projectId !== viewer.projectId) return false
  return true
}

export interface PublishTarget {
  tenantId: string
  projectId?: string | null
  updatedBy: string
}

export interface PublishedOwnership {
  ownerScope: 'project'
  tenantId: string
  projectId: string | null
  updatedBy: string
}

/**
 * 私人资源发布到团队：仅 private 可发布，显式动作，不存在默认共享。
 * @throws {Error} 非 private 资源重复发布时抛出。
 */
export function publishOwnership(resource: OwnershipRef, target: PublishTarget): PublishedOwnership {
  if ((resource.ownerScope ?? 'private') !== 'private') throw new Error('仅私人资源可发布到团队')
  if (!target.tenantId) throw new Error('发布目标缺少 tenantId')
  return {
    ownerScope: 'project',
    tenantId: target.tenantId,
    projectId: target.projectId ?? null,
    updatedBy: target.updatedBy,
  }
}

/** 增量同步事件（M1 只定契约，Local 返回空页，M4 服务端填充）。 */
export interface SyncEvent {
  seq: number
  type: string
  resourceKind: 'blueprint' | 'knowledge'
  resourceId: string
  version: number
  actorId: string
  tenantId?: string | null
  occurredAt: string
}

export interface SyncCursor {
  lastSeq: number
}

export interface SyncPage {
  events: SyncEvent[]
  nextCursor: SyncCursor
  hasMore: boolean
}

export const EMPTY_SYNC_PAGE: SyncPage = { events: [], nextCursor: { lastSeq: 0 }, hasMore: false }

/** Repository 调用方身份：userId + 活跃组织/项目上下文（角色每次实时查 Membership，不塞 token）。 */
export interface RepositoryActor {
  userId: string
  tenantId?: string | null
  projectId?: string | null
}

export interface BlueprintCreateInput {
  name: string
  description?: string
  rootTitle?: string
}

export type BlueprintUpdatePatch = Partial<Pick<Blueprint, 'name' | 'description' | 'canvasLayout' | 'collapsedNodeIds'>>

export interface BlueprintRepository {
  get(workspace: string, id: string, viewer: ViewerRef): Promise<Blueprint | null>
  list(workspace: string, viewer: ViewerRef): Promise<Blueprint[]>
  create(workspace: string, input: BlueprintCreateInput, actor: RepositoryActor): Promise<Blueprint>
  update(
    workspace: string,
    id: string,
    patch: BlueprintUpdatePatch,
    opts: { baseVersion?: number },
    actor: RepositoryActor,
  ): Promise<Blueprint | null>
  /** 私人蓝图一键发布到团队；归属变更计一次语义版本。 */
  publish(workspace: string, id: string, target: PublishTarget, actor: RepositoryActor): Promise<Blueprint | null>
  listChanges(since: SyncCursor): Promise<SyncPage>
}

/** Knowledge 可共享条目需满足的归属子集（fact / wiki / graph 真相实体均满足）。 */
export interface ShareableKnowledgeItem {
  id: string
  ownerScope?: OwnerScope
  tenantId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
  updatedBy?: string | null
}

export interface KnowledgeRepository<T extends ShareableKnowledgeItem = ShareableKnowledgeItem> {
  get(id: string, viewer: ViewerRef): Promise<T | null>
  list(viewer: ViewerRef): Promise<T[]>
  publish(id: string, target: PublishTarget, actor: RepositoryActor): Promise<T | null>
  listChanges(since: SyncCursor): Promise<SyncPage>
}
