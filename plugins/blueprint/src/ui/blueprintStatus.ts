/**
 * @file 蓝图节点状态 → 视觉映射（颜色 / 标签）
 * @description 对应 design §5.2 状态色映射。供自定义节点卡片 + 右键状态子菜单共用。
 */

import type { BlueprintNodeStatus } from '../shared/janus/types'
import { blueprintStatusFilter } from '../shared/blueprint-note-status'
import type { BlueprintNode } from '../shared/janus/types'

export type BlueprintStatusFilter = BlueprintNodeStatus | `note:${string}` | 'all'
export function blueprintStatusOptions(nodes: BlueprintNode[], translate: (key: string) => string) {
  const statuses = [...new Set(nodes.map(blueprintStatusFilter))]
  return statuses.map(value => ({ value, label: translate(value.startsWith('note:') ? 'blueprint:noteStatus.' + value.slice(5) : getBlueprintStatusVisual(value as BlueprintNodeStatus).labelKey) }))
}

export interface StatusVisual {
  /** 圆点颜色 */
  color: string
  /** 默认标签（迁移期保留，调用方应优先用 labelKey + t()） */
  label: string
  /** i18n key，调用方用 t(labelKey) 取本地化标签 */
  labelKey: string
}

/**
 * 状态 → 视觉映射表（顺序即菜单展示顺序）。
 * 灰阶区分等待与规划，强调色表达在途，成功与异常使用共享状态色。
 * CSS 变量在绘制时解析，已挂载的节点和菜单随宿主主题一起更新。
 */
export const STATUS_VISUALS: Record<BlueprintNodeStatus, StatusVisual> = {
  'not-started': { color: 'var(--shell-dim)', label: '未开始', labelKey: 'blueprint:status.notStarted' },
  planning: { color: 'var(--shell-muted)', label: '规划中', labelKey: 'blueprint:status.planning' },
  'in-progress': { color: 'var(--shell-accent)', label: '进行中', labelKey: 'blueprint:status.inProgress' },
  testing: { color: 'var(--shell-muted)', label: '测试中', labelKey: 'blueprint:status.testing' },
  'bug-fixing': { color: 'var(--status-warning)', label: '修Bug', labelKey: 'blueprint:status.bugFixing' },
  blocked: { color: 'var(--status-danger)', label: '阻塞', labelKey: 'blueprint:status.blocked' },
  paused: { color: 'var(--shell-dim)', label: '已暂停', labelKey: 'blueprint:status.paused' },
  done: { color: 'var(--status-success)', label: '已完成', labelKey: 'blueprint:status.done' },
  archived: { color: 'var(--shell-dim)', label: '已归档', labelKey: 'blueprint:status.archived' }
}

/** Status paint follows the host tokens, including runtime plugin palettes. */
export function getBlueprintStatusVisual(status: BlueprintNodeStatus, _theme?: unknown): StatusVisual {
  return STATUS_VISUALS[status] ?? STATUS_VISUALS['not-started']
}

/** 菜单展示顺序 */
export const STATUS_ORDER: BlueprintNodeStatus[] = [
  'not-started',
  'planning',
  'in-progress',
  'testing',
  'bug-fixing',
  'blocked',
  'paused',
  'done',
  'archived'
]

/** 节点类型 → i18n key */
export const NODE_TYPE_LABEL_KEY: Record<string, string> = {
  epic: 'blueprint:nodeType.epic',
  feature: 'blueprint:nodeType.feature',
  task: 'blueprint:nodeType.task',
  issue: 'blueprint:nodeType.issue'
}

/** 节点类型 → 简短标签（迁移期保留，调用方应优先用 NODE_TYPE_LABEL_KEY + t()） */
export const NODE_TYPE_LABEL: Record<string, string> = {
  epic: 'Epic',
  feature: 'Feature',
  task: 'Task',
  issue: 'Issue'
}

/** note kind 列表（NoteDoc 原始词汇，对齐 NoteAdapter v1 与高保真 kind 过滤） */
export const NOTE_KINDS = ['module', 'note', 'idea', 'requirement', 'decision', 'task', 'initiative'] as const
export type NoteKindFilter = (typeof NOTE_KINDS)[number] | 'all'

/** note kind → i18n key（未知 kind 回退原文直显） */
export const NOTE_KIND_LABEL_KEY: Record<string, string> = {
  module: 'blueprint:noteKind.module',
  note: 'blueprint:noteKind.note',
  idea: 'blueprint:noteKind.idea',
  initiative: 'blueprint:noteKind.initiative',
  requirement: 'blueprint:noteKind.requirement',
  decision: 'blueprint:noteKind.decision',
  task: 'blueprint:noteKind.task'
}

/** type → kind 回退映射（legacy JSON 节点无 kind 透传时用；同 nodeTypeToKind 无 preferred 分支） */
const TYPE_TO_KIND_FALLBACK: Record<string, string> = {
  task: 'task',
  feature: 'requirement',
  issue: 'requirement',
  epic: 'initiative'
}

/** 节点的 note kind：harness 投影读透传值，legacy  lane 按 type 回退 */
export function noteKindOf(node: { kind?: string; type: string }): string {
  if (node.kind) return node.kind
  return TYPE_TO_KIND_FALLBACK[node.type] ?? 'idea'
}
