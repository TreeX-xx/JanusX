/**
 * @file 需求候选（Requirement Candidates）纯函数
 * @description 候选去重 key 与建议父节点解析（audit A1 自 blueprint-store 拆出）。
 */

import type { Blueprint } from '../../shared/janus/types'

function normalizeCandidatePart(value?: string): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function candidateKey(sourceNodeId: string, title: string, description: string, suggestedParentTitle?: string): string {
  return [
    sourceNodeId,
    normalizeCandidatePart(title),
    normalizeCandidatePart(description),
    normalizeCandidatePart(suggestedParentTitle)
  ].join('|')
}

export function resolveSuggestedParentId(bp: Blueprint, suggestedParentTitle?: string): string | undefined {
  const normalized = normalizeCandidatePart(suggestedParentTitle)
  if (!normalized) return undefined
  const parent = Object.values(bp.nodes).find((node) => normalizeCandidatePart(node.title) === normalized)
  return parent?.id
}
