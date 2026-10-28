import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeContextResult } from '../../../src/shared/knowledge'

const { search, searchWithUser, recordAccess, recordProjectAccess, capture, streamText, getSession, executeFunctionCall, scheduleImmediate, capturePersonTurn, capturePersonEpisode } = vi.hoisted(() => ({
  search: vi.fn(),
  searchWithUser: vi.fn(),
  recordAccess: vi.fn(),
  recordProjectAccess: vi.fn(),
  capture: vi.fn(),
  streamText: vi.fn(),
  getSession: vi.fn(),
  executeFunctionCall: vi.fn(),
  scheduleImmediate: vi.fn(),
  capturePersonTurn: vi.fn(),
  capturePersonEpisode: vi.fn(),
}))
const { readMemo, createMemo } = vi.hoisted(() => ({ readMemo: vi.fn(), createMemo: vi.fn() }))
vi.mock('../../../src/main/memo/service', () => ({ memoStore: () => ({ get: readMemo, create: createMemo }) }))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/janusx-test' } }))
vi.mock('../../../src/main/knowledge/context-service', () => ({
  knowledgeContextService: { search, searchWithUser },
}))
vi.mock('../../../src/main/knowledge/memory-access', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/main/knowledge/memory-access')>(),
  recordUserMemoryAccessBestEffort: recordAccess,
  recordProjectMemoryAccessBestEffort: recordProjectAccess,
}))
vi.mock('../../../src/main/knowledge/observation-service', () => ({
  knowledgeObservationService: { capture },
}))
// Engineering capture now passes through captureEngineeringUserMemory, which gates on
// memoryDomainPolicy().inferEngineeringHabits (default false). Opt in so the gate is not
// what the assertions are actually about.
vi.mock('../../../src/main/knowledge/memory-domain-policy', () => ({
  memoryDomainPolicy: async () => ({
    project: false, personal: true, capturePersonal: true,
    inferEngineeringHabits: true, recallPersonal: true, episodeTtlDays: 30,
  }),
}))
vi.mock('../../../src/main/knowledge/processing-queue', () => ({
  knowledgeProcessingQueue: { scheduleImmediate },
}))
vi.mock('../../../src/main/knowledge/user-turn-capture', () => ({
  capturePersonChatTurn: capturePersonTurn,
  capturePersonEpisodeFromTurn: capturePersonEpisode,
}))
vi.mock('../../../src/main/llm/LlmService', () => ({
  llmService: {
    getProviderSettings: vi.fn(async () => ({ modelId: 'test-model' })),
    getLanguageModel: vi.fn(async () => ({})),
    listModels: vi.fn(async () => []),
    resolveModelMetadata: vi.fn(async () => ({ effectiveContextWindow: 16384, maxOutputTokens: 4096 })),
  },
}))
vi.mock('../../../src/main/llm/chat-model-stream', () => ({ streamChatModel: streamText }))
vi.mock('../../../src/main/llm/ai-runtime', () => ({
  generateText: vi.fn(),
  streamText,
}))
vi.mock('../../../src/main/agent/runtime/shell-runtime', () => ({
  workspaceAgentRuntime: {
    getSession,
    executeFunctionCall,
    registry: { list: () => [] },
  },
}))

import { abortChatStream, answerChatQuestion, gateFromToolAllowlist, handleChatStream, prepareJanusChatRecall, steerChatStream } from '../../../src/main/llm/chat-orchestrator'
import { llmService } from '../../../src/main/llm/LlmService'
import { configService } from '../../../src/main/config/service'
import { DEFAULT_EXPERIMENTAL_FEATURES } from '../../../src/shared/ipc/experimental'

const emptyResult: KnowledgeContextResult = {
  items: [],
  compactContext: '',
  truncated: false,
  eligibleCount: 0,
  maxItems: 5,
  maxChars: 3_000,
}

const userMessages = [{ role: 'user' as const, content: 'hello' }]

function immediateStream(text: string) {
  streamText.mockResolvedValue({
    textStream: (async function* () {
      yield text
    })(),
  })
}

describe('chat turn guard (S6-a)', () => {
  it('offers memo tools despite retired disabled controls in persisted configuration', async () => {
    vi.mocked(configService.getExperimentalFeatures).mockResolvedValue({ ...DEFAULT_EXPERIMENTAL_FEATURES, memo: false, sessions: false } as never)
    const memoId = '00000000-0000-4000-8000-000000000400'
    readMemo.mockResolvedValue({ id: memoId, title: 'Existing memo', revision: 1, nodes: [] })
    immediateStream('Memo available')
    const reply = vi.fn()
    await handleChatStream({ reply } as never, {
      requestId: 'memo-default', conversationId: 'memo-default-chat', providerId: 'p',
      sourceTag: 'janus-chat', domain: 'project', messages: userMessages,
      memoMessageId: 'default-origin', memoBinding: { memoId, messageId: 'default-origin', selectedNodeId: null },
    })
    const options = streamText.mock.calls[0][0]
    expect(Object.keys(options.tools ?? {})).toEqual(expect.arrayContaining(['memo_read', 'memo_edit']))
    expect(JSON.stringify(options.messages)).not.toContain('Memo preview is disabled')
    expect(readMemo).toHaveBeenCalledWith(memoId)
    expect(createMemo).not.toHaveBeenCalled()
    expect(reply.mock.calls.some(([channel]) => channel === 'llm:chat:error')).toBe(false)
  })
  it('offers unbound memo creation and emits a binding for the originating message', async () => {
    const memo = { id: '00000000-0000-4000-8000-000000000300', title: '工程排期', revision: 0, nodes: [] }
    createMemo.mockResolvedValue(memo)
    immediateStream('Created in the left memo workspace')
    streamText.mockImplementationOnce(async options => {
      expect(Object.keys(options.tools)).toContain('memo_create')
      expect(JSON.stringify(options.messages)).toContain('never substitute a repository Note')
      return { textStream: (async function* () {})(), fullStream: (async function* () {
        yield { type: 'tool-call', toolCallId: 'create', toolName: 'memo_create', args: { title: '工程排期' } }
        yield { type: 'finish', finishReason: 'tool-calls' }
      })() }
    })
    const reply = vi.fn()
    await handleChatStream({ reply } as never, { requestId: 'memo-create', conversationId: 'memo-create-chat', providerId: 'p', sourceTag: 'janus-chat', domain: 'project', memoMessageId: 'origin-message', messages: [{ role: 'user', content: '帮我建立一个关于工程排期的里程碑备忘录' }] })
    expect(createMemo).toHaveBeenCalledWith('工程排期', expect.any(Function))
    expect(reply).toHaveBeenCalledWith('llm:chat:agent-event', { type: 'memo_created', requestId: 'memo-create', conversationId: 'memo-create-chat', binding: { memoId: memo.id, messageId: 'origin-message', selectedNodeId: null } })
    expect(reply.mock.calls.some(([channel]) => channel === 'llm:chat:error')).toBe(false)
  })

  it('refreshes selected star context across turns in the same cached conversation', async () => {
    const memoId = '00000000-0000-4000-8000-000000000100'
    const nodes = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102']
    readMemo.mockResolvedValue({ id: memoId, title: 'Memo', revision: 1, nodes: nodes.map(id => ({ id, title: id, label: '', points: [] })) })
    immediateStream('Memo read')
    const reply = vi.fn()
    for (const [index, selectedNodeId] of nodes.entries()) {
      await handleChatStream({ reply } as never, { requestId: `memo-selection-${index}`, conversationId: 'memo-selection-cache', providerId: 'p', sourceTag: 'janus-chat', messages: userMessages,
        memoBinding: { memoId, messageId: `memo-message-${index}`, selectedNodeId } })
      const context = JSON.stringify(streamText.mock.calls.at(-1)![0])
      expect(context).toContain(JSON.stringify({ status: 'selected', nodeId: selectedNodeId }).replaceAll('"', '\\"'))
    }
    expect(reply.mock.calls.some(([channel]) => channel === 'llm:chat:error')).toBe(false)
  })

  it('passes each steering message its own selected star without changing the original context', async () => {
    const memoId = '00000000-0000-4000-8000-000000000200'
    const nodes = ['00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202']
    readMemo.mockResolvedValue({ id: memoId, title: 'Memo', revision: 1, nodes: nodes.map(id => ({ id, title: id, label: '', points: [] })) })
    let release!: () => void
    immediateStream('Done')
    streamText.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve })
      return { textStream: (async function* () { yield 'Initial' })() }
    })
    const reply = vi.fn()
    const turn = handleChatStream({ reply } as never, { requestId: 'memo-steer', conversationId: 'memo-steer-chat', providerId: 'p', sourceTag: 'janus-chat', messages: userMessages,
      memoBinding: { memoId, messageId: 'first-message', selectedNodeId: nodes[0] } })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const input = { conversationId: 'memo-steer-chat', entryId: 'next-message', text: 'Record in this star', memoBinding: { memoId, messageId: 'next-message', selectedNodeId: nodes[1] } }
    expect(steerChatStream(input).accepted).toBe(true)
    expect(steerChatStream(input).accepted).toBe(true)
    expect(steerChatStream({ ...input, memoBinding: { ...input.memoBinding, selectedNodeId: nodes[0] } }).accepted).toBe(false)
    release()
    await turn
    expect(streamText.mock.calls.length).toBeGreaterThanOrEqual(2)
    const messages = streamText.mock.calls.at(-1)![0].messages as Array<{ role: string; content: string }>
    const steered = messages.filter(message => typeof message.content === 'string' && message.content.startsWith(input.text))
    expect(steered).toHaveLength(1)
    expect(steered[0].content).toContain(JSON.stringify({ memoId, messageId: 'next-message', selectedNode: { status: 'unverified', nodeId: nodes[1] } }))
    expect(JSON.stringify(messages)).toContain('first-message')
    expect(reply.mock.calls.some(([channel]) => channel === 'llm:chat:error')).toBe(false)
  })

  it('switches WorkflowX mode without resolving a provider or starting a model stream', async () => {
    vi.mocked(llmService.getLanguageModel).mockClear()
    streamText.mockClear()
    const reply = vi.fn()
    await handleChatStream({ reply } as never, { requestId: 'mode-switch', providerId: '', sourceTag: 'janus-chat', messages: [{ role: 'user', content: '/xflow' }] })
    expect(llmService.getLanguageModel).not.toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith('llm:chat:delta', expect.objectContaining({ delta: 'WorkflowX: xflow' }))
    expect(reply).toHaveBeenCalledWith('llm:chat:done', { requestId: 'mode-switch' })
  })
  it.each(['maintenanceTaskId', 'noteRepairId'] as const)('rejects retired %s before model access and releases the conversation', async field => {
    vi.mocked(llmService.getLanguageModel).mockClear()
    const reply = vi.fn()
    const request = { requestId: 'retired-' + field, conversationId: 'retired-' + field, providerId: 'p', domain: 'project' as const, sourceTag: 'janus-chat' as const, messages: userMessages, [field]: 'legacy-operation' }
    await handleChatStream({ reply } as never, request)
    expect(reply).toHaveBeenCalledWith('llm:chat:error', expect.objectContaining({ error: expect.stringContaining('BLUEPRINT_PLUGIN_REQUIRED') }))
    expect(streamText).not.toHaveBeenCalled()
    expect(llmService.getLanguageModel).not.toHaveBeenCalled()
    expect(steerChatStream({ conversationId: request.conversationId, entryId: 'late', text: 'late' }).accepted).toBe(false)
    immediateStream('Normal project conversation still works.')
    await handleChatStream({ reply } as never, { ...request, requestId: request.requestId + '-normal', [field]: undefined })
    expect(reply).toHaveBeenCalledWith('llm:chat:done', { requestId: request.requestId + '-normal' })
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  beforeEach(() => {
    vi.spyOn(configService, 'getExperimentalFeatures').mockResolvedValue({ ...DEFAULT_EXPERIMENTAL_FEATURES })
    readMemo.mockReset()
    createMemo.mockReset()
    vi.mocked(llmService.getProviderSettings).mockReset().mockResolvedValue({ modelId: 'test-model' } as never)
    vi.mocked(llmService.resolveModelMetadata).mockReset().mockResolvedValue({ effectiveContextWindow: 16384, maxOutputTokens: 4096 } as never)
    search.mockReset().mockResolvedValue(emptyResult)
    searchWithUser.mockReset().mockImplementation(input => search(input))
    recordAccess.mockReset().mockResolvedValue(undefined)
    recordProjectAccess.mockReset().mockResolvedValue(undefined)
    capture.mockReset().mockResolvedValue(undefined)
    streamText.mockReset()
    getSession.mockReset()
    executeFunctionCall.mockReset()
    capturePersonTurn.mockReset().mockResolvedValue(undefined)
    capturePersonEpisode.mockReset().mockResolvedValue(undefined)
  })

  it('passes detected maximum output to inference despite an old context-only setting', async () => {
    vi.mocked(llmService.getProviderSettings).mockResolvedValue({ modelId: 'test-model', extra: { chatModelLimits: { 'test-model': { contextWindow: 1000000 } } } } as never)
    vi.mocked(llmService.resolveModelMetadata).mockResolvedValue({ effectiveContextWindow: 1048576, maxOutputTokens: 65536 } as never)
    immediateStream('Acknowledged.')
    const reply = vi.fn()
    await handleChatStream({ reply } as never, { requestId: 'automatic-output', providerId: 'p', messages: userMessages })
    expect(streamText).toHaveBeenCalledOnce()
    expect(streamText.mock.calls[0][0]).toMatchObject({ maxTokens: 65536 })
    expect(reply).toHaveBeenCalledWith('llm:chat:done', { requestId: 'automatic-output' })
  })

  it('delivers provider reasoning through the real SDK and agent loop into ordered IPC', async () => {
    const { streamChatModel } = await vi.importActual<typeof import('../../../src/main/llm/chat-model-stream')>('../../../src/main/llm/chat-model-stream')
    const provider = { specificationVersion: 'v3', provider: 'fixture', modelId: 'fixture',
      doStream: async () => ({ stream: new ReadableStream({ start(controller) {
        for (const chunk of [
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-delta', id: 'r1', delta: 'Inspect the entry.' },
          { type: 'text-delta', id: 't1', delta: 'Working explanation.' },
          { type: 'reasoning-delta', id: 'r2', delta: 'Verify the conclusion.' },
          { type: 'text-delta', id: 't2', delta: 'Final answer.' },
          { type: 'finish', finishReason: { unified: 'stop' }, usage: { inputTokens: { total: 5 }, outputTokens: { total: 10 } } },
        ]) controller.enqueue(chunk)
        controller.close()
      } }) }) }
    vi.mocked(llmService.getLanguageModel).mockResolvedValueOnce(provider as never)
    streamText.mockImplementationOnce(streamChatModel)
    const reply = vi.fn()
    await handleChatStream({ reply } as never, { requestId: 'provider-timeline', conversationId: 'provider-timeline', providerId: 'p', domain: 'project', messages: userMessages })
    const events = reply.mock.calls.filter(([channel]) => channel === 'llm:chat:agent-event').map(([, event]) => event)
    expect(events.filter(event => ['reasoning_delta', 'text_delta'].includes(event.type))).toEqual([
      { type: 'reasoning_delta', requestId: 'provider-timeline', delta: 'Inspect the entry.' },
      { type: 'text_delta', requestId: 'provider-timeline', delta: 'Working explanation.' },
      { type: 'reasoning_delta', requestId: 'provider-timeline', delta: 'Verify the conclusion.' },
      { type: 'text_delta', requestId: 'provider-timeline', delta: 'Final answer.' },
    ])
    expect(events.at(-1)).toMatchObject({ type: 'stream_end', cancelled: false })
  })

  it('rejects a second concurrent turn on the same conversation', async () => {
    let releaseFirst!: (value: unknown) => void
    const gate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    streamText.mockImplementationOnce(async () => {
      await gate
      return {
        textStream: (async function* () {
          yield 'first'
        })(),
      }
    })
    const replyFirst = vi.fn()
    const replySecond = vi.fn()

    const first = handleChatStream({ reply: replyFirst } as never, {
      requestId: 's6a-req-1',
      conversationId: 's6a-conv-busy',
      messages: userMessages,
      providerId: 'provider-a',
      sourceTag: 'janus-chat',
    } as never)
    for (let attempt = 0; attempt < 200 && streamText.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(streamText.mock.calls.length).toBeGreaterThan(0)

    await handleChatStream({ reply: replySecond } as never, {
      requestId: 's6a-req-2',
      conversationId: 's6a-conv-busy',
      messages: userMessages,
      providerId: 'provider-a',
      sourceTag: 'janus-chat',
    } as never)

    expect(streamText.mock.calls.length).toBe(1)
    expect(replySecond).toHaveBeenCalledWith(
      'llm:chat:error',
      expect.objectContaining({ requestId: 's6a-req-2', error: expect.stringContaining('BUSY') }),
    )

    releaseFirst(undefined)
    await first
    expect(replyFirst).toHaveBeenCalledWith('llm:chat:done', { requestId: 's6a-req-1' })
    expect(replyFirst.mock.calls.some(([channel]) => channel === 'llm:chat:error')).toBe(false)
  })

  it('lets different conversations run concurrently', async () => {
    immediateStream('ok')
    const replyA = vi.fn()
    const replyB = vi.fn()

    await Promise.all([
      handleChatStream({ reply: replyA } as never, {
        requestId: 's6a-req-a',
        conversationId: 's6a-conv-a',
        messages: userMessages,
        providerId: 'provider-a',
        sourceTag: 'janus-chat',
      } as never),
      handleChatStream({ reply: replyB } as never, {
        requestId: 's6a-req-b',
        conversationId: 's6a-conv-b',
        messages: userMessages,
        providerId: 'provider-a',
        sourceTag: 'janus-chat',
      } as never),
    ])

    expect(streamText.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(replyA).toHaveBeenCalledWith('llm:chat:done', { requestId: 's6a-req-a' })
    expect(replyB).toHaveBeenCalledWith('llm:chat:done', { requestId: 's6a-req-b' })
    for (const reply of [replyA, replyB]) {
      expect(reply.mock.calls.some(([channel, payload]) => channel === 'llm:chat:error'
        && String((payload as { error?: unknown }).error ?? '').includes('BUSY'))).toBe(false)
    }
  })

  it('rejects stale or unknown mid-turn answers without touching another request', () => {
    expect(
      answerChatQuestion({ requestId: 's6a-missing', callId: 'nope', answer: { status: 'cancelled' } }),
    ).toEqual({ accepted: false, error: 'No pending question for this request' })
    expect(
      answerChatQuestion({ requestId: 's6a-missing', callId: '', answer: { status: 'cancelled' } as never }),
    ).toEqual({ accepted: false, error: 'Invalid call id' })
  })

  it('keeps project turns out of personal memory even without a workspace', async () => {
    immediateStream('project answer')
    const reply = vi.fn()

    await handleChatStream({ reply } as never, {
      requestId: 's6b-project-1',
      conversationId: 's6b-conv-project',
      messages: userMessages,
      providerId: 'provider-a',
      sourceTag: 'janus-chat',
      domain: 'project',
    } as never)

    expect(reply).toHaveBeenCalledWith('llm:chat:done', { requestId: 's6b-project-1' })
    expect(capturePersonTurn).not.toHaveBeenCalled()
    expect(capturePersonEpisode).not.toHaveBeenCalled()
  })

  it('binds engineering and personal captures to host speaker, event, and conversation', async () => {
    immediateStream('personal answer')
    await handleChatStream({ reply: vi.fn() } as never, {
      requestId: 'evidence-turn', conversationId: 'evidence-conversation',
      workspaceId: 'evidence-project', workspacePath: 'C:/evidence-project',
      messages: userMessages, providerId: 'provider-a', sourceTag: 'janus-chat', domain: 'personal',
    } as never)
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'user', sessionId: 'evidence-conversation' }),
      { speaker: 'user', sourceEventId: 'evidence-turn' },
    )
    // Engineering activity contributes only opted-in personal habits, never assistant
    // turns and never project facts — see knowledge/engineering-user-memory.ts.
    expect(capture).not.toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'assistant' }),
      expect.objectContaining({ speaker: 'assistant' }),
    )
    await handleChatStream({ reply: vi.fn() } as never, {
      requestId: 'personal-evidence-turn', conversationId: 'personal-evidence-conversation',
      messages: userMessages, providerId: 'provider-a', sourceTag: 'janus-chat', domain: 'personal',
    } as never)
    expect(capturePersonTurn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'personal-evidence-conversation', correlationId: 'personal-evidence-turn',
    }))
  })

  it.each(['personal', 'project', 'failure'] as const)('records delivered context at the production stream boundary: %s', async mode => {
    const section = '[janus-user-memory]\nPrefer pnpm\n[/janus-user-memory]'
    const delivery = { capturedAt: Date.now(), section, facts: [{ id: 'personal', hash: 'snapshot' }] }
    // Project memory delivery was retired with the memory reorientation, so only the
    // personal receipt is left to record at the stream boundary.
    search.mockResolvedValue({ ...emptyResult, compactContext: 'Engineering memory' })
    searchWithUser.mockResolvedValue({ ...emptyResult, compactContext: 'Engineering memory\n\n' + section, userMemoryDelivery: delivery })
    streamText.mockImplementation(async () => {
      expect(recordAccess).not.toHaveBeenCalled()
      return { textStream: (async function* () {
        expect(recordAccess).not.toHaveBeenCalled()
        if (mode === 'failure') throw new Error('provider unavailable')
        yield 'answer'
      })() }
    })
    await handleChatStream({ reply: vi.fn() } as never, {
      requestId: `delivery-${mode}`, conversationId: `delivery-${mode}`,
      workspaceId: 'workspace',
      messages: userMessages, providerId: 'provider-a', sourceTag: 'janus-chat', domain: mode === 'project' ? 'project' : 'personal',
    } as never)
    if (mode === 'personal') {
      expect(recordAccess).toHaveBeenCalledExactlyOnceWith(delivery, `delivery-${mode}`, expect.any(AbortSignal))
    } else expect(recordAccess).not.toHaveBeenCalled()
  })

  it('skips personal recall injection for project domain when a user search exists', async () => {
    const projectSearch = vi.fn(async () => emptyResult)
    const userSearch = vi.fn(async () => ({ compactContext: '[user] private', items: [] }) as never)

    const personal = await prepareJanusChatRecall(
      's6b-recall-personal',
      [{ role: 'user' as const, content: 'hello' }],
      undefined,
      undefined,
      projectSearch,
      userSearch,
    )
    expect(userSearch).toHaveBeenCalledTimes(1)
    expect(personal.messages.some((message) => message.content.includes('[user] private'))).toBe(true)

    userSearch.mockClear()
    const project = await prepareJanusChatRecall(
      's6b-recall-project',
      [{ role: 'user' as const, content: 'hello' }],
      undefined,
      undefined,
      projectSearch,
      userSearch,
      'project',
    )
    expect(userSearch).not.toHaveBeenCalled()
    expect(project.messages.some((message) => message.content.includes('[user] private'))).toBe(false)
  })

  it('manual compaction emits a checkpoint without adding a reply or running tools', async () => {
    const messages = Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Decision ${index}` }))
    const original = JSON.stringify(messages)
    immediateStream('## Goal\nPreserve decisions.\n## Progress\nReviewed.\n## Next Steps\nContinue.')
    const reply = vi.fn()
    await handleChatStream({ reply } as never, {
      requestId: 'manual-compact', conversationId: 'manual-compact', providerId: 'provider-a',
      messages, compact: { keepRecentUnits: 4 }, domain: 'personal',
    })
    const state = reply.mock.calls.find(([, payload]) => payload.type === 'context_state' && payload.state.phase === 'compacted')?.[1].state
    expect(state?.checkpoint.coveredMessages).toBe(10)
    expect(streamText).toHaveBeenCalledTimes(1)
    expect(streamText.mock.calls[0][0].tools).toBeUndefined()
    expect(executeFunctionCall).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith('llm:chat:done', { requestId: 'manual-compact' })
    expect(JSON.stringify(messages)).toBe(original)
  })
})

describe('dual-gate tool surface (launch assistant)', () => {
  it('blocks calls outside the allowlist and feeds the reason back to the model', async () => {
    const gate = gateFromToolAllowlist(['workspace.list', 'workspace.read', 'launch-config.apply'])
    const blocked = await gate!({ name: 'command.run', arguments: {} })
    expect(blocked).toEqual({ block: true, reason: expect.stringContaining('command.run') })
    const future = await gate!({ name: 'mcp_status', arguments: {} })
    expect(future).toEqual({ block: true, reason: expect.stringContaining('mcp_status') })
  })

  it('matches allowlist names loosely like the offered-tool normalizer', async () => {
    const gate = gateFromToolAllowlist(['workspace.list'])
    expect(await gate!({ name: 'workspace_list', arguments: {} })).toBeUndefined()
    expect(await gate!({ name: 'Workspace.List', arguments: {} })).toBeUndefined()
  })

  it('delegates listed calls to the host policy gate and keeps its refusal', async () => {
    const policy = vi.fn(async () => ({ block: true as const, reason: 'lease changed' }))
    const gate = gateFromToolAllowlist(['workspace.read'], policy)
    expect(await gate!({ name: 'workspace.read', arguments: { path: 'a' } })).toEqual({ block: true, reason: 'lease changed' })
    expect(policy).toHaveBeenCalledWith({ name: 'workspace.read', arguments: { path: 'a' } })
    expect(await gate!({ name: 'git.push', arguments: {} })).toEqual({ block: true, reason: expect.stringContaining('git.push') })
    expect(policy).toHaveBeenCalledTimes(1)
  })

  it('without an allowlist the policy gate stands alone and legacy turns stay unchanged', async () => {
    expect(gateFromToolAllowlist(undefined)).toBeUndefined()
    const policy = vi.fn(async () => undefined)
    expect(gateFromToolAllowlist(undefined, policy)).toBe(policy)
  })
})
