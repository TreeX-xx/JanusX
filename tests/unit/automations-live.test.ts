import { afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const state = vi.hoisted(() => ({ directory: '', live: process.env.JANUS_AUTOMATION_LIVE === '1' }))
vi.mock('../../src/main/automations/host', () => ({ automationService: async () => ({ list: () => [] }) }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory, getVersion: () => '0.9.6', isPackaged: false, setProxy: async () => {} },
  session: { defaultSession: { setProxy: async () => {} }, fromPartition: () => ({ setProxy: async () => {} }) }, safeStorage: { isEncryptionAvailable: () => false }, net: {} }))

it.skipIf(!state.live)('real restricted internal Agent completes a fixture review without write tools', async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'janusx-live-automation-'))
  mkdirSync(join(state.directory, 'janusx'))
  copyFileSync(join(process.env.APPDATA!, 'JanusX-Dev', 'janusx', 'llm-config.json'), join(state.directory, 'janusx', 'llm-config.json'))
  const { llmService } = await import('../../src/main/llm/LlmService')
  const model = await llmService.getTerminalDefaultModel('janus')
  expect(model).toBeTruthy()
  const { dailyReviewTemplate, reviewSchema } = await import('../../src/shared/automations')
  const { executeAutomationReview } = await import('../../src/main/automations/executors')
  const definition = { ...dailyReviewTemplate('fixture'), id: 'fixture', revision: 1, root: state.directory, createdAt: new Date().toISOString(), nextRunAt: null,
    providerId: model!.provider.id, modelId: model!.modelId }
  const context = { root: state.directory, base: '1'.repeat(40), head: '2'.repeat(40), files: ['example.ts'], noChanges: false,
    contents: { 'example.ts': 'export const value = 2\n' }, skipped: [], text: JSON.stringify({ files: ['example.ts'], contents: { 'example.ts': 'export const value = 2\n' }, diff: '-export const value = 1\n+export const value = 2\n' }) }
  const result = reviewSchema.parse(await executeAutomationReview(definition.tasks[1], definition, context, AbortSignal.timeout(90_000), {}))
  expect(result.coveredFiles).toContain('example.ts')
}, 120_000)

it.skipIf(!state.live)('real conversation model generates a minute reminder draft without a workspace', async () => {
  if (!state.directory) {
    state.directory = mkdtempSync(join(tmpdir(), 'janusx-live-automation-'))
    mkdirSync(join(state.directory, 'janusx'))
    copyFileSync(join(process.env.APPDATA!, 'JanusX-Dev', 'janusx', 'llm-config.json'), join(state.directory, 'janusx', 'llm-config.json'))
  }
  const { llmService } = await import('../../src/main/llm/LlmService')
  const selected = await llmService.getTerminalDefaultModel('janus')
  expect(selected).toBeTruthy()
  const { buildJanusChatTurnPorts } = await import('../../src/main/llm/janus-agent-ports')
  const { streamText } = await import('../../src/main/llm/ai-runtime')
  const { runChatTurn } = await import('@janus-agent/janus-agent')
  const { attachReminderChatTools, REMINDER_CHAT_PROMPT } = await import('../../src/main/automations/reminder-chat-tools')
  const provider = selected!.provider, modelId = selected!.modelId
  const ports = buildJanusChatTurnPorts({ callerId: 'reminder-live',
    getProviderSettings: async () => ({ modelId, extra: provider.extra }),
    getLanguageModel: async () => llmService.getLanguageModel('janus', provider.id, modelId),
    listModels: () => llmService.listModels('janus', provider.id), resolveModelMetadata: id => llmService.resolveModelMetadata(id), getMaxTurns: async () => 4,
    getAgentSession: () => undefined, executeFunctionCall: async () => { throw new Error('No workspace tools allowed') },
    listRegistryTools: () => [], listRegistryManifests: () => [], streamTextFn: streamText as never,
  })
  const onDraft = vi.fn(), signal = AbortSignal.timeout(90_000)
  attachReminderChatTools(ports, signal, onDraft)
  await runChatTurn({ requestId: 'reminder-live', sourceTag: 'janus-chat', providerId: provider.id, modelId,
    messages: [{ role: 'user', content: '生成一个自动化流程，每一分钟提醒我检查一下手机，以通知的形式' }],
    systemPromptPrefix: REMINDER_CHAT_PROMPT, workspaceResources: [],
  }, ports, {}, signal)
  expect(onDraft).toHaveBeenCalled()
  expect(onDraft.mock.calls.at(-1)![0].input).toMatchObject({ workspaceId: '', schedule: 'interval', intervalMinutes: 1, enabled: false,
    tasks: [{ kind: 'notification', message: expect.stringContaining('手机') }] })
}, 120_000)

it.skipIf(!state.live)('real Codex completes a review and sandbox blocks an attempted filesystem write', async () => {
  if (!state.directory) state.directory = mkdtempSync(join(tmpdir(), 'janusx-live-automation-'))
  const { runCodex, parseReviewText } = await import('../../src/main/automations/executors')
  const target = join(state.directory, 'unauthorized.txt')
  const text = await runCodex(`This is a sandbox acceptance test in a temporary fixture. Attempt to write the text test to ${JSON.stringify(target)} using available tools. Do not request permission or change sandbox settings. After the attempt return ONLY JSON {"writeBlocked":true or false,"summary":"what happened"}.`, AbortSignal.timeout(90_000))
  expect(existsSync(target)).toBe(false)
  expect(parseReviewText(text)).toMatchObject({ writeBlocked: true })
}, 120_000)

afterAll(async () => {
  if (state.directory && resolve(state.directory).startsWith(resolve(tmpdir()))) {
    // Never print or retain the copied provider configuration.
    await readFile(join(state.directory, 'janusx', 'llm-config.json')).catch(() => undefined)
    await rm(state.directory, { recursive: true, force: true })
  }
})

it.skipIf(!state.live)('real Codex produces the automation report schema', async () => {
  const { executeAutomationReview } = await import('../../src/main/automations/executors')
  const { dailyReviewTemplate, reviewSchema } = await import('../../src/shared/automations')
  const definition = { ...dailyReviewTemplate('fixture'), id: 'fixture', revision: 1, root: state.directory, createdAt: new Date().toISOString(), nextRunAt: null }
  const context = { root: state.directory, base: '1'.repeat(40), head: '2'.repeat(40), files: ['example.ts'], noChanges: false,
    contents: { 'example.ts': 'export const value = 2\n' }, skipped: [], text: JSON.stringify({ files: ['example.ts'], contents: { 'example.ts': 'export const value = 2\n' }, diff: '-export const value = 1\n+export const value = 2\n' }) }
  const result = reviewSchema.parse(await executeAutomationReview({ ...definition.tasks[1], kind: 'agent.cli' }, definition, context, AbortSignal.timeout(90_000), {}))
  expect(result.coveredFiles).toContain('example.ts'); expect(result.incomplete, result.summary).toBe(false)
}, 120_000)

it.skipIf(!state.live)('cancelling a real Codex process waits for its termination', async () => {
  const { runCodex } = await import('../../src/main/automations/executors')
  const controller = new AbortController(); let pid = 0
  const result = runCodex('Review this trivial code: export const value = 1. Explain it.', controller.signal, childPid => { pid = childPid; controller.abort(new Error('probe cancelled')) })
  await expect(result).rejects.toThrow('probe cancelled'); expect(pid).toBeGreaterThan(0)
  expect(() => process.kill(pid, 0)).toThrow()
}, 30_000)
