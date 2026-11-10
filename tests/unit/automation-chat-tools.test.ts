import { beforeEach, expect, it, vi } from 'vitest'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { dailyReviewTemplate, type AutomationDefinition } from '../../src/shared/automations'
import { attachAutomationTools } from '../../src/main/automations/chat-tools'
import { automationNotification } from '../../src/renderer/src/components/janus/islandNotifications'

const host = vi.hoisted(() => ({ list: vi.fn(), input: vi.fn(), preview: vi.fn(), run: vi.fn(), history: vi.fn() }))
vi.mock('../../src/main/automations/host', () => ({ automationService: async () => host }))
beforeEach(() => { vi.clearAllMocks(); host.list.mockReturnValue([]) })
function attach() {
  const ports = { tools: { registry: { list: () => [] }, executeFunctionCall: vi.fn() } } as unknown as ChatTurnPorts
  const onDraft = vi.fn(), controller = new AbortController()
  attachAutomationTools(ports, { workspaceId: 'project', providerId: 'provider', modelId: 'model', sessionIds: ['session'], signal: controller.signal, onDraft })
  const invoke = (name: string, input: object = {}, sessionId = 'session') => ports.tools.executeFunctionCall({ sessionId, call: { toolName: `automation.${name}`, input } }, 'caller')
  return { ports, onDraft, invoke, controller }
}
it('proposes a validated disabled draft, never silently saving or scheduling it', async () => {
  const { onDraft, invoke } = attach()
  expect((await invoke('propose', { input: { name: 'Daily review', enabled: true } })).status).toBe('completed')
  expect(onDraft.mock.calls[0][0].input).toMatchObject({ enabled: false, workspaceId: 'project', providerId: 'provider', modelId: 'model' })
  expect(host.run).not.toHaveBeenCalled(); expect(host.preview).not.toHaveBeenCalled()
})
it('refuses an unavailable workspace session and invalid task bindings', async () => {
  const { invoke, onDraft } = attach()
  expect((await invoke('propose', {}, 'other')).status).toBe('failed')
  expect((await invoke('propose', { input: { tasks: [{ id: 'shell', kind: 'command', command: 'rm' }] } })).status).toBe('failed')
  expect(onDraft).not.toHaveBeenCalled()
})
it('requires the exact saved revision when staging edits and never broadens run authorization', async () => {
  const card: AutomationDefinition = { ...dailyReviewTemplate('project'), providerId: 'p', modelId: 'm', id: 'card', revision: 2, root: '/fixture', createdAt: '', nextRunAt: null }
  host.list.mockReturnValue([card]); host.input.mockReturnValue({ ...dailyReviewTemplate('project'), providerId: 'p', modelId: 'm' })
  const { invoke, onDraft } = attach()
  expect((await invoke('update', { id: 'card', revision: 1, input: { name: 'Changed' } })).status).toBe('failed')
  expect((await invoke('run', { id: 'card' })).status).toBe('failed'); expect(host.run).not.toHaveBeenCalled()
  expect((await invoke('update', { id: 'card', revision: 2, input: { enabled: true } })).status).toBe('completed')
  expect(onDraft.mock.calls[0][0]).toMatchObject({ id: 'card', revision: 2, input: { enabled: true } })
})
it('routes approved saved runs with an idempotency key and publishes only a result action', async () => {
  host.list.mockReturnValue([{ id: 'card', enabled: true }]); const { invoke } = attach()
  expect((await invoke('run', { id: 'card' })).status).toBe('completed'); expect(host.run).toHaveBeenCalledWith('card', expect.any(String))
  const notice = automationNotification({ id: 'run', state: 'needs_attention', snapshot: { ...dailyReviewTemplate('project'), name: 'Review' }, finishedAt: '2026-11-02T00:00:00Z', reason: 'baseline_conflict' } as never)
  expect(notice).toMatchObject({ id: 'automation:run', kind: 'automation', severity: 'attention', actions: [{ id: 'open-automation', primary: true }] })
})
