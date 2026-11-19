import { expect, it } from 'vitest'
import { formatWorkerElapsed, latestWorkerInput, workerHeadline, workerPrompt, workerReply, workerStream, workerTiming } from '../../src/renderer/src/components/janus/workerPresentation'
import type { SuperAgentWorkerSnapshot } from '../../src/shared/superagent-worker'
import type { SuperAgentWorkDetail } from '../../src/shared/superagent'

const worker = () => ({ phase: 'running', conversation: { connection: 'ready', turnId: 'now', items: [
  { type: 'commandExecution', turnId: 'old', status: 'inProgress', text: 'OLD COMMAND' },
  { type: 'userMessage', turnId: 'now', text: 'PRIVATE BOOTSTRAP' },
  { type: 'commandExecution', turnId: 'now', status: 'inProgress', text: 'npm test\nRunning test 1' },
] } }) as SuperAgentWorkerSnapshot

it('uses explicit current task steps for the heading and never promotes recent output into a summary', () => {
  const current = worker()
  expect(workerHeadline('Original task', current)).toBe('Original task')
  current.conversation.items.push({ id: 'reply', turnId: 'now', type: 'agentMessage', status: 'completed', text: 'Check keyboard navigation\n\nMore context' })
  expect(workerHeadline('Original task', current)).toBe('Original task')
  expect(workerReply(current).text).toBe('Check keyboard navigation\n\nMore context')
  for (const text of ['Reading configuration files', '## 已读取菜单文件\n下一步运行检查', '核对选项菜单的主题样式']) {
    current.conversation.items.push({ id: text, turnId: 'now', type: 'agentMessage', status: 'completed', text })
    expect(workerHeadline('Original task', current)).toBe('Original task')
    expect(workerReply(current).text).toBe(text)
  }
  current.conversation.plans = [{ turnId: 'now', version: 1, explanation: '', outcome: 'running', steps: [{ step: 'Verify narrow layouts', status: 'inProgress' }] }]
  expect(workerHeadline('Original task', current)).toBe('Verify narrow layouts')
  current.conversation.turnId = 'next'
  expect(workerHeadline('Original task', current)).toBe('Original task')
  current.conversation.items.push({ id: 'log', turnId: 'next', type: 'agentMessage', status: 'completed', text: 'Read input 5158180d-1364-4d97-b692-970ffb0cb753' })
  expect(workerHeadline('Original task', current)).toBe('Original task')
  expect(workerHeadline('Original task', { ...current, restored: true })).toBe('Original task')
  current.phase = 'ready'; current.executionId = 'run'
  current.report = { executionId: 'run', summary: 'Keyboard checks passed' } as NonNullable<SuperAgentWorkerSnapshot['report']>
  expect(workerHeadline('Original task', current)).toBe('Keyboard checks passed')
  current.phase = 'running'
  expect(workerHeadline('Original task', current)).toBe('Original task')
})

it('times only a confirmed native turn, freezes recorded durations and never invents completion or restored timing', () => {
  const current = worker()
  expect(workerTiming(current, 45000)).toBeNull()
  current.conversation.turnStartedAt = 3000
  expect(workerTiming(current, 45000)).toEqual({ seconds: 42, running: true })
  current.phase = 'waiting'
  expect(workerTiming(current, 46000)?.seconds).toBe(43)
  current.stopConfirmed = true
  expect(workerTiming(current, 90000)).toBeNull()
  current.conversation.turnId = null; current.conversation.turnStartedAt = undefined; current.phase = 'idle'
  current.conversation.items.push({ id: 'final', turnId: 'now', type: 'agentMessage', status: 'completed', text: 'Done', durationMs: 42100 })
  expect(workerTiming(current, 90000)).toEqual({ seconds: 42, running: false })
  expect(workerTiming(current, 190000)?.seconds).toBe(42)
  expect(workerTiming({ ...current, restored: true }, 190000)).toBeNull()
  current.phase = 'starting'
  expect(workerTiming(current, 190000)).toBeNull()
  expect(formatWorkerElapsed(42)).toBe('00:42'); expect(formatWorkerElapsed(3661)).toBe('1:01:01')
})

it('projects only current native commands, updates output and never leaks bootstrap messages', () => {
  const current = worker()
  expect(workerStream(current)).toMatchObject({ text: '$ npm test\nRunning test 1', running: true })
  current.conversation.items[2].text += '\nTest 1 passed'
  expect(workerStream(current).text).toContain('Test 1 passed')
  current.conversation.items[2].status = 'completed'
  expect(workerStream(current)).toMatchObject({ text: '', running: false })
})

it('does not present interrupted, restored, stopped or disconnected snapshots as executing', () => {
  for (const phase of ['waiting', 'idle', 'failed', 'stopping', 'stopped', 'interrupted', 'ready'] as const) {
    expect(workerStream({ ...worker(), phase }).running).toBe(false)
    expect(workerStream({ ...worker(), phase }).text).toBe('')
  }
  expect(workerStream({ ...worker(), restored: true }).text).toBe('')
  expect(workerStream({ ...worker(), stopConfirmed: true }).text).toBe('')
  const disconnected = worker(); disconnected.conversation.connection = 'disconnected'
  expect(workerStream(disconnected).text).toBe('')
})

it('keeps full available output for scrolling and preserves native truncation', () => {
  const current = worker(); current.conversation.items[2].text = 'npm test\n' + 'x'.repeat(4000) + '\nLAST OUTPUT'
  const result = workerStream(current)
  expect(result.truncated).toBe(false); expect(result.text.startsWith('$ npm test')).toBe(true)
  expect(result.text.endsWith('LAST OUTPUT')).toBe(true); expect(result.text).toBe('$ ' + current.conversation.items[2].text)
  current.conversation.items[2].truncated = true
  expect(workerStream(current).truncated).toBe(true)
})

it('selects the newest delivered prompt for this work, excluding pending, unknown and other work', () => {
  const detail = { work: { id: 'work', sourceInputId: 'first' }, inputs: [
    { id: 'first', sequence: 1 }, { id: 'latest', sequence: 2 }, { id: 'pending', sequence: 3 }, { id: 'foreign', sequence: 4 },
  ], deliveries: [{ inputId: 'latest', workId: 'work', status: 'delivered' },
    { inputId: 'pending', workId: 'work', status: 'unknown' }, { inputId: 'foreign', workId: 'other', status: 'delivered' }] } as SuperAgentWorkDetail
  expect(latestWorkerInput(detail)?.id).toBe('latest')
})

it('keeps the latest reply independently of commands and after execution ends', () => {
  const current = worker()
  current.conversation.items.push({ id: 'reply', type: 'agentMessage', turnId: 'now', text: 'Latest reply', status: 'completed' })
  expect(workerReply(current).text).toBe('Latest reply')
  expect(workerStream(current).text).toContain('$ npm test')
  current.phase = 'idle'
  expect(workerReply(current).text).toBe('Latest reply')
  expect(workerStream(current).text).toBe('')
  expect(workerReply(worker()).text).toBe('')
})

it('shows the latest native assignment and reports unavailable or truncated records honestly', () => {
  const current = worker()
  current.conversation.items.push({ id: 'assignment', type: 'userMessage', turnId: 'now', text: 'Assigned work: full goal and constraints', status: 'completed', truncated: true })
  expect(workerPrompt(current)).toEqual({ text: 'Assigned work: full goal and constraints', truncated: true })
  expect(workerPrompt()).toEqual({ text: '', truncated: false })
})
