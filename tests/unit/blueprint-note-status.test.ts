import { expect, it } from 'vitest'
import { blueprintNoteStatus } from '../../plugins/blueprint/src/shared/blueprint-note-status'
import type { BlueprintNode } from '../../plugins/blueprint/src/shared/janus/types'

const node = (kind: string, lifecycle = 'accepted', fields = {}): BlueprintNode => ({ kind, lifecycle, note: { kind, lifecycle, ...fields } }) as BlueprintNode
it('does not translate accepted documents or tasks without execution into running work', () => {
  expect(blueprintNoteStatus(node('decision'))).toBe('已采纳')
  expect(blueprintNoteStatus(node('requirement'))).toBe('已接受')
  expect(blueprintNoteStatus(node('task'))).toBe('无执行记录')
  expect(blueprintNoteStatus(node('module', 'accepted', { moduleState: 'partial' }))).toBe('部分实现')
})
it('completion requires valid results and archived history retains its lifecycle', () => {
  const task = node('task', 'accepted', { metadata: { execution: { state: 'done' } } })
  expect(blueprintNoteStatus(task)).toBe('完成记录待验证')
  task.noteEvidence = { taskDone: true }
  expect(blueprintNoteStatus(task)).toBe('已完成（有效结果）')
  task.note!.lifecycle = 'archived'
  expect(blueprintNoteStatus(task)).toBe('已归档 · 已完成（有效结果）')
  const requirement = node('requirement'); requirement.noteEvidence = { coveredACs: 1, totalACs: 3 }
  expect(blueprintNoteStatus(requirement)).toBe('已接受 · 验收 1/3')
})
