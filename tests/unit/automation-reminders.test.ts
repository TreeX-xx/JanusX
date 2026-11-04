import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { runChatTurn, type ChatTurnPorts } from '@janus-agent/janus-agent'
import { AutomationService } from '../../src/main/automations/service'
import { atomicJson } from '../../src/main/automations/storage'
import { automationInputSchema, reminderTemplate, type AutomationDraft } from '../../src/shared/automations'
import { attachReminderChatTools, REMINDER_CHAT_PROMPT } from '../../src/main/automations/reminder-chat-tools'
import { nextOccurrence } from '../../src/main/automations/schedule'
import { automationNotification } from '../../src/renderer/src/components/janus/islandNotifications'

const host = vi.hoisted(() => ({ service: undefined as AutomationService | undefined }))
vi.mock('../../src/main/automations/host', () => ({ automationService: async () => host.service }))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn() })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'janus-reminder-'))
  cleanups.push(async () => { if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup'); await rm(dir, { recursive: true, force: true }) })
  const now = { value: Date.parse('2026-11-03T09:00:00Z') }
  const ports = { resolveWorkspace: vi.fn(), review: vi.fn(), changed: vi.fn(), removed: vi.fn(), completed: vi.fn(), now: () => now.value }
  const service = new AutomationService(dir, ports); await service.initialize(false); host.service = service
  cleanups.push(() => service.stop())
  return { service, ports, dir, now }
}
it('validates independent reminders and rejects unsupported configurations', () => {
  const input = reminderTemplate('检查一下手机')
  expect(automationInputSchema.parse(input).workspaceId).toBe('')
  for (const patch of [{ intervalMinutes: 0 }, { intervalMinutes: 1.5 }, { intervalMinutes: undefined }, { workspaceId: 'project' }, { tasks: [] }, { tasks: [{ id: 'n', kind: 'notification', message: '' }] }]) {
    expect(automationInputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
  }
  expect(nextOccurrence({ ...input, enabled: true }, 0)).toBe('1970-01-01T00:01:00.000Z')
})
it('deletes an enabled card and history durably while keeping other cards and exported files', async () => {
  const { service, ports, dir, now } = await fixture()
  const card = await service.save({ ...reminderTemplate('Delete me'), enabled: true })
  const keep = await service.save(reminderTemplate('Keep me'))
  await writeFile(join(dir, 'export.txt'), 'User export')
  await service.run(card.id, 'before-delete')
  await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledOnce())
  await service.remove(card.id, card.revision)
  expect(service.list().map(item => item.id)).toEqual([keep.id]); expect(service.history(card.id)).toEqual([])
  expect(ports.removed).toHaveBeenCalledExactlyOnceWith(card.id)
  await expect(readFile(join(dir, card.id, 'definition.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(service.run(card.id, 'before-delete')).rejects.toThrow('not found')
  now.value += 60_000; await service.tick(); await service.stop()
  const restored = new AutomationService(dir, ports); await restored.initialize(false); cleanups.push(() => restored.stop())
  await restored.tick()
  expect(restored.list().map(item => item.id)).toEqual([keep.id]); expect(restored.history(card.id)).toEqual([])
  expect(ports.completed).toHaveBeenCalledOnce()
  expect(await readFile(join(dir, 'export.txt'), 'utf8')).toBe('User export')
})
it('rejects stale revisions and unsafe deletion IDs before touching the card', async () => {
  const { service, ports, dir } = await fixture()
  const card = await service.save(reminderTemplate('Keep this revision'))
  await service.save({ ...service.input(card), name: 'Updated' }, card.id, card.revision)
  await expect(service.remove(card.id, card.revision)).rejects.toThrow('revision_conflict')
  await expect(service.remove('../outside', 1)).rejects.toThrow('Invalid automation ID')
  expect(service.list()[0].name).toBe('Updated'); expect(ports.removed).not.toHaveBeenCalled()
  expect(JSON.parse(await readFile(join(dir, card.id, 'definition.json'), 'utf8')).revision).toBe(2)
})
it('finishes an interrupted deletion before replaying an old edit journal on startup', async () => {
  const { service, ports, dir } = await fixture()
  const card = await service.save(reminderTemplate('Must not return'))
  await service.stop()
  const cursor = JSON.parse(await readFile(join(dir, card.id, 'cursor.json'), 'utf8'))
  await atomicJson(join(dir, card.id, 'edit.json'), { definition: { ...card, revision: 2 }, cursor })
  await atomicJson(join(dir, `${card.id}.deleted.json`), { revision: card.revision })
  const restored = new AutomationService(dir, ports); await restored.initialize(false); cleanups.push(() => restored.stop())
  expect(restored.list()).toEqual([]); expect(ports.completed).not.toHaveBeenCalled()
  await expect(readFile(join(dir, card.id, 'edit.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(join(dir, `${card.id}.deleted.json`))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('draft → save → scheduled notification → edit → disable → restart without project or model', async () => {
  const { service, ports, dir, now } = await fixture()
  const chat = {} as ChatTurnPorts, onDraft = vi.fn(), signal = new AbortController().signal
  attachReminderChatTools(chat, signal, onDraft)
  const tool = chat.localTools![0]
  const call = (args: object) => tool.execute({ arguments: args } as never, signal)
  expect((await call({ action: 'propose', name: '检查手机', message: '检查一下手机', intervalMinutes: 1, enabled: true })).isError).not.toBe(true)
  const draft = onDraft.mock.calls[0][0] as AutomationDraft
  expect(draft.input.enabled).toBe(false); expect(service.list()).toHaveLength(0)
  let card = await service.save({ ...draft.input, enabled: true })
  now.value += 60_000; await service.tick()
  await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledTimes(1))
  const run = service.history(card.id)[0]
  expect(run).toMatchObject({ state: 'succeeded', message: '检查一下手机', trigger: 'scheduled' })
  expect(automationNotification(run).copy.subtitleText).toBe('检查一下手机')
  await service.tick(); expect(service.history(card.id)).toHaveLength(1)
  expect((await call({ action: 'propose', id: card.id, revision: 0, intervalMinutes: 30 })).isError).toBe(true)
  await call({ action: 'propose', id: card.id, revision: card.revision, intervalMinutes: 30, message: '休息一下' })
  const edit = onDraft.mock.calls.at(-1)![0] as AutomationDraft
  card = await service.save(edit.input, edit.id, edit.revision)
  expect(Date.parse(card.nextRunAt!) - now.value).toBe(30 * 60_000)
  card = await service.save({ ...service.input(card), enabled: false }, card.id, card.revision)
  now.value += 31 * 60_000; await service.tick(); expect(service.history(card.id)).toHaveLength(1)
  await service.stop()
  const restored = new AutomationService(dir, ports); await restored.initialize(false); cleanups.push(() => restored.stop())
  expect(restored.list()[0]).toMatchObject({ enabled: false, intervalMinutes: 30 })
  expect(restored.history(card.id)[0].message).toBe('检查一下手机')
  expect(ports.completed).toHaveBeenCalledTimes(1)
  expect(ports.review).not.toHaveBeenCalled(); expect(ports.resolveWorkspace).not.toHaveBeenCalled()
})
it('coalesces missed intervals and only delivers the new occurrence once', async () => {
  const { service, ports, now } = await fixture()
  const card = await service.save({ ...reminderTemplate('提醒'), enabled: true })
  now.value += 10 * 60_000
  await Promise.all([service.tick(), service.tick()])
  await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledTimes(1))
  expect(service.history(card.id)).toHaveLength(1)
  expect(Date.parse(service.list()[0].nextRunAt!) - now.value).toBe(60_000)
  now.value += 80_000; await service.tick()
  expect(Date.parse(service.list()[0].nextRunAt!) - now.value).toBe(40_000)
})
it('normal chat loop offers and executes reminder tools without a workspace', async () => {
  const { service } = await fixture()
  let rounds = 0
  const ports: ChatTurnPorts = {
    model: { resolve: async () => ({ model: {}, modelId: 'fixture' }), getMaxTurns: () => 4 },
    sessions: { getSession: () => null },
    tools: { registry: { list: () => [] }, executeFunctionCall: async () => { throw new Error('No workspace tools') } },
    streamTextFn: async options => {
      expect(Object.keys(options.tools as object)).toContain('automation_reminder')
      if (rounds++ === 0) return { textStream: (async function* () {})(), fullStream: (async function* () {
        yield { type: 'tool-call', toolCallId: 'remind', toolName: 'automation_reminder', args: { action: 'propose', message: '检查一下手机', intervalMinutes: 1 } }
        yield { type: 'finish', finishReason: 'tool-calls' }
      })() }
      expect(JSON.stringify(options.messages)).toContain('saved')
      return { textStream: (async function* () { yield '草案已生成，请在右侧启用。' })() }
    },
  }
  const draft = vi.fn()
  attachReminderChatTools(ports, new AbortController().signal, draft)
  const result = await runChatTurn({ requestId: 'reminder', providerId: 'fixture', sourceTag: 'janus-chat', systemPromptPrefix: REMINDER_CHAT_PROMPT,
    messages: [{ role: 'user', content: '生成一个自动化流程，每一分钟提醒我检查一下手机，以通知的形式' }] }, ports)
  expect(draft).toHaveBeenCalledOnce(); expect(service.list()).toHaveLength(0)
  expect(result.toolTraces.map(trace => trace.toolName)).toEqual(['automation_reminder'])
})
it('rejects missing schedules and cancelled generation instead of inventing a reminder', async () => {
  await fixture()
  const ports = {} as ChatTurnPorts, controller = new AbortController(), draft = vi.fn()
  attachReminderChatTools(ports, controller.signal, draft)
  const call = (args: object) => ports.localTools![0].execute({ id: 'r', name: 'automation_reminder', arguments: args }, controller.signal)
  for (const args of [{ message: '手机' }, { message: '手机', schedule: 'daily' }, { message: '手机', schedule: 'interval' }]) {
    expect((await call({ action: 'propose', ...args })).isError).toBe(true)
  }
  controller.abort()
  expect((await call({ action: 'propose', message: '手机', intervalMinutes: 1 })).isError).toBe(true)
  expect(draft).not.toHaveBeenCalled()
})
