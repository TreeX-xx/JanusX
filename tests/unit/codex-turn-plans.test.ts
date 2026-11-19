import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DesktopCodexConversation } from '../../src/main/terminal/codex-conversation'
import { readCodexTurnPlans } from '../../src/main/terminal/codex-turn-plans'

const threadId = 'fixture-thread'
const event = (type: string, turn_id: string) => ({ type: 'event_msg', payload: { type, turn_id } })
const call = (id: string, step: string) => ({
  type: 'response_item',
  payload: { type: 'function_call', name: 'update_plan', call_id: id,
    arguments: JSON.stringify({ plan: [{ step, status: 'in_progress' }] }) },
})
const result = (id: string, output = 'Plan updated') => ({
  type: 'response_item', payload: { type: 'function_call_output', call_id: id, output },
})

async function withRollout(use: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'janusx-codex-plans-'))
  const path = join(dir, `rollout-test-${threadId}.jsonl`)
  try {
    const rows = [
      { type: 'session_meta', payload: { id: threadId } },
      event('task_started', 'first'), call('a', 'First draft'), result('a'),
      call('b', 'Final first plan'), result('b'),
      call('c', 'Rejected revision'), result('c', 'Invalid input'),
      event('task_complete', 'first'),
      event('task_started', 'second'), call('d', 'Second plan'), result('d'),
      event('turn_aborted', 'second'),
      event('task_started', 'unconfirmed'), call('e', 'Unfinalized'), result('e'),
    ]
    await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    await use(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

it('restores only the last successful plan per finished turn from an identity-matched rollout', async () => {
  await withRollout(async path => {
    const plans = await readCodexTurnPlans(path, threadId)
    expect([...plans.keys()]).toEqual(['first', 'second'])
    expect(plans.get('first')).toMatchObject({ version: 2, outcome: 'completed', steps: [{ step: 'Final first plan', status: 'inProgress' }] })
    expect(plans.get('second')).toMatchObject({ version: 1, outcome: 'interrupted', steps: [{ step: 'Second plan' }] })
    expect((await readCodexTurnPlans(path, 'other-thread')).size).toBe(0)
  })
})

it('puts matching restored plans in native history and drops them when the session changes', async () => {
  await withRollout(async path => {
    const publish = vi.fn()
    const controller = new DesktopCodexConversation('plan-projection', publish)
    const wire = controller as any
    const answer = { type: 'agentMessage', id: 'answer', text: 'Earlier response' }
    try {
      wire.attach({ id: threadId, path, turns: [{ id: 'first', status: 'completed', items: [answer] }] })
      await vi.waitFor(() => expect(controller.snapshot().plans?.map(plan => plan.turnId)).toEqual(['first']))
      vi.spyOn(wire, 'call').mockResolvedValue({ data: [{ turnId: 'second', item: answer }] })
      const page = await controller.readHistory({ type: 'page', threadId })
      expect(page).toMatchObject({ type: 'page', plans: [{ turnId: 'second', outcome: 'interrupted' }] })
      wire.attach({ id: 'different', turns: [{ id: 'first', status: 'completed', items: [answer] }] })
      expect(controller.snapshot().plans).toEqual([])
    } finally {
      await controller.dispose()
    }
  })
})

it('keeps an earlier final plan when the next turn uses all native revision slots', async () => {
  const controller = new DesktopCodexConversation('plan-projection', () => {})
  const wire = controller as any
  const send = (method: string, params: object) => wire.receive({ method, params: { threadId, ...params } })
  try {
    wire.attach({ id: threadId, turns: [] })
    send('turn/started', { turn: { id: 'first' } })
    send('item/completed', { turnId: 'first', item: { id: 'reply', type: 'agentMessage', text: 'Earlier reply' } })
    send('turn/plan/updated', { turnId: 'first', plan: [{ step: 'First plan', status: 'completed' }] })
    send('turn/completed', { turn: { id: 'first', status: 'completed' } })
    send('turn/started', { turn: { id: 'second' } })
    for (let index = 0; index <= 100; index++) {
      send('turn/plan/updated', { turnId: 'second', plan: [{ step: `Revision ${index}`, status: 'pending' }] })
    }
    expect(controller.snapshot().plans).toMatchObject([
      { turnId: 'first', outcome: 'completed', steps: [{ step: 'First plan' }] },
      { turnId: 'second', outcome: 'running', steps: [{ step: 'Revision 100' }] },
    ])
  } finally {
    await controller.dispose()
  }
})
