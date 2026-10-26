// Note: lifecycle, implementation and valid execution are distinct — see .agents/notes/blueprint/navigation/note-status-display.md
import type { BlueprintNode } from './janus/types'

type StatusNode = Pick<BlueprintNode, 'kind' | 'lifecycle' | 'note' | 'noteEvidence'>
export interface NoteStatusPart { key: string; values?: Record<string, string | number> }
export const NOTE_STATUS_LABELS: Record<string, string> = {
  draft: '草稿', proposed: '提案', accepted: '已接受', implemented: '已实施', rejected: '已拒绝', archived: '已归档',
  'module-planned': '规划中', 'module-partial': '部分实现', 'module-implemented': '已实现', 'module-retired': '已退役', 'module-unknown': '模块状态未声明',
  queued: '排队', running: '执行中', verifying: '验证中', blocked: '阻塞', paused: '已暂停', cancelled: '已取消',
  done: '已完成（有效结果）', unverified: '完成记录待验证', unrecorded: '无执行记录', 'execution-unknown': '未知执行状态',
  adopted: '已采纳', coverage: '验收 {{covered}}/{{total}}', unknown: '未知状态',
}
export function blueprintNoteStatusParts(node: StatusNode): NoteStatusPart[] {
  const note = node.note
  if (!note && !node.lifecycle) return []
  const kind = note?.kind ?? node.kind
  const state = note?.lifecycle ?? node.lifecycle ?? ''
  const lifecycle = { key: NOTE_STATUS_LABELS[state] ? state : 'unknown' }
  const inactive = state === 'archived' || state === 'rejected'
  if (kind === 'module') return [inactive ? lifecycle : { key: NOTE_STATUS_LABELS['module-' + note?.moduleState] ? 'module-' + note?.moduleState : 'module-unknown' }]
  if (kind === 'task') {
    const run = note?.metadata?.execution?.state
    const detail = { key: run === 'done' ? node.noteEvidence?.taskDone ? 'done' : 'unverified' : run ? NOTE_STATUS_LABELS[run] ? run : 'execution-unknown' : 'unrecorded' }
    return inactive ? [lifecycle, detail] : [detail]
  }
  if (kind === 'requirement' && node.noteEvidence?.totalACs !== undefined) return [lifecycle, { key: 'coverage', values: { covered: node.noteEvidence.coveredACs ?? 0, total: node.noteEvidence.totalACs } }]
  return [kind === 'decision' && state === 'accepted' ? { key: 'adopted' } : lifecycle]
}
export function blueprintNoteStatus(node: StatusNode): string | undefined {
  return blueprintNoteStatusParts(node).map(part => (NOTE_STATUS_LABELS[part.key] ?? part.key).replace(/\{\{(\w+)\}\}/g, (_, key) => String(part.values?.[key] ?? ''))).join(' · ') || undefined
}
export function blueprintStatusFilter(node: StatusNode & { status: string }): string {
  const part = blueprintNoteStatusParts(node)[0]
  return part ? 'note:' + part.key : node.status
}
