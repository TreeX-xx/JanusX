/**
 * @file Blueprint 节点/需求项工厂与归一化
 * @description 纯函数，无 IO、无 electron 依赖（audit A1 自 blueprint-store 拆出）。
 */

import { randomUUID } from 'node:crypto'
import type {
  BlueprintFeatureItem,
  BlueprintFeatureStatus,
  BlueprintNode,
  BlueprintNodeType
} from '../../shared/janus/types'

export function nowIso(): string {
  return new Date().toISOString()
}

export function makeFeatureItem(input: Partial<BlueprintFeatureItem> & { title: string }): BlueprintFeatureItem {
  const ts = nowIso()
  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    description: input.description ?? '',
    progress: input.progress ?? 0,
    status: input.status ?? 'planned',
    requirementNotes: input.requirementNotes ?? [],
    createdAt: input.createdAt ?? ts,
    updatedAt: input.updatedAt ?? ts
  }
}

export function normalizeFeatureStatus(status?: BlueprintFeatureStatus): BlueprintFeatureStatus {
  return status ?? 'planned'
}

export function makeNode(input: Partial<BlueprintNode> & { title: string; type: BlueprintNodeType }): BlueprintNode {
  const ts = nowIso()
  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    type: input.type,
    status: input.status ?? 'not-started',
    progress: input.progress ?? 0,
    statusSource: input.statusSource ?? 'manual',
    positioning: input.positioning ?? '',
    description: input.description ?? '',
    features: Array.isArray(input.features) ? input.features.map((feature) => makeFeatureItem(feature)) : [],
    completedItems: input.completedItems ?? [],
    techSolution: input.techSolution ?? '',
    notes: input.notes ?? '',
    todos: input.todos ?? [],
    issues: input.issues ?? [],
    activities: input.activities ?? [],
    analyses: input.analyses ?? [],
    workspaceId: input.primaryWorkspaceId ?? input.workspaceId ?? null,
    primaryWorkspaceId: input.primaryWorkspaceId ?? input.workspaceId ?? null,
    linkedWorkspaceIds: input.linkedWorkspaceIds ?? [],
    workspaceSnapshot: input.workspaceSnapshot ?? null,
    boundTerminalId: input.boundTerminalId ?? null,
    terminalHistory: input.terminalHistory ?? [],
    lastAnalyzedCommitSha: input.lastAnalyzedCommitSha ?? null,
    children: input.children ?? [],
    parentId: input.parentId ?? null,
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? ts,
    updatedAt: ts
  }
}
