/**
 * Twin tests for the JanusX shell ports adapter (M3 separation).
 * @description Each case mirrors a pre-separation behavior of
 * `main/llm/chat-orchestrator.handleChatStream`: same errors, same payloads,
 * same fan-out routing. Any intentional deviation must update the case name
 * with the reason. No Electron/singleton imports — all deps are injected.
 */
import { describe, expect, it, vi } from 'vitest'
import { runChatTurn } from '@janus-agent/janus-agent'
import type { KnowledgeContextResult } from '@janus-agent/chat-core'
import { ManagedChatSession } from '../../../src/main/llm/managed-chat-session'
import { openRouterRecordToRegistryEntry } from '@janusx/llm-core'
import {
  buildJanusChatTurnPorts,
  type JanusChatTurnPortsDeps,
} from '../../../src/main/llm/janus-agent-ports'

function baseDeps(overrides: Partial<JanusChatTurnPortsDeps> = {}): JanusChatTurnPortsDeps {
  return {
    callerId: 'renderer:1',
    getProviderSettings: async () => ({ modelId: 'm1' }),
    getLanguageModel: async () => ({ fake: 'model' }),
    listModels: async () => [],
    getMaxTurns: async () => 40,
    getAgentSession: () => null,
    executeFunctionCall: async () => {
      throw new Error('unexpected tool call')
    },
    listRegistryTools: () => [],
    listRegistryManifests: () => undefined,
    knowledgeSearch: async () => {
      throw new Error('unexpected knowledge search')
    },
    captureObservation: async () => ({ workspaceId: 'ws1' }),
    scheduleSettled: () => undefined,
    streamTextFn: (async () => ({
      textStream: (async function* () {})(),
    })) as JanusChatTurnPortsDeps['streamTextFn'],
    ...overrides,
  }
}

describe('model port', () => {
  it('requires both manual limits when automatic detection is unavailable, and blocks incomplete inference', async () => {
    const model = vi.fn(async () => ({ fake: 'model' }))
    const getProviderSettings = vi.fn(async () => ({ modelId: 'custom-model', extra: { chatModelLimits: { 'custom-model': { contextWindow: 1000000 } } } }))
    const ports = buildJanusChatTurnPorts(baseDeps({ getLanguageModel: model, getProviderSettings, resolveModelMetadata: async () => undefined }))
    await expect(ports.model.resolve('custom')).rejects.toThrow('MODEL_LIMITS_UNAVAILABLE')
    expect(model).not.toHaveBeenCalled()
    getProviderSettings.mockResolvedValue({ modelId: 'custom-model', extra: { chatModelLimits: { 'custom-model': { contextWindow: 1000000, maxOutputTokens: 65536 } } } } as never)
    expect(await ports.model.resolve('custom')).toMatchObject({ contextWindow: 1000000, maxOutputTokens: 65536, source: 'configured' })
  })
  it.each([undefined, 16_384])('uses live Gemini metadata before compaction over bundled capacity %s', async contextWindow => {
    const metadata = openRouterRecordToRegistryEntry({ id: 'google/gemini-3.8-flash', name: 'Google: Gemini 3.8 Flash',
      context_length: 1_048_576, top_provider: { max_completion_tokens: 65_536 } })!
    const resolveModelMetadata = vi.fn(async () => metadata)
    const stream = vi.fn(async () => ({ textStream: (async function* () { yield 'Full context retained' })() }))
    const ports = buildJanusChatTurnPorts(baseDeps({
      getProviderSettings: async () => ({ modelId: 'gemini-3.8-flash' }),
      listModels: async () => [{ id: 'gemini-3.8-flash', supportsFunctionCalling: true, contextWindow, maxOutputTokens: 4096 }], resolveModelMetadata,
      knowledgeSearch: undefined, captureObservation: undefined, streamTextFn: stream,
    }))
    const endpoint = await ports.model.resolve('vertex')
    expect(endpoint).toMatchObject({ contextWindow: 1_048_576, maxOutputTokens: 65_536, source: 'registry' })
    expect(resolveModelMetadata).toHaveBeenCalledWith('gemini-3.8-flash')
    const messages = Array.from({ length: 31 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Decision ${index}: ` + 'rule '.repeat(1000) }))
    const session = new ManagedChatSession()
    session.beginTurn(messages, 'scope', undefined, () => {}, 'registry')
    const summarize = vi.fn()
    await runChatTurn({ requestId: 'automatic-gemini', providerId: 'vertex', messages, chatSession: session, compactionSummarizer: summarize }, ports)
    expect(summarize).not.toHaveBeenCalled()
    expect(stream).toHaveBeenCalledOnce()
    expect(messages).toHaveLength(31)
  })

  it('keeps automatic Gemini context and 65k output despite a saved manual context', async () => {
    const resolveModelMetadata = vi.fn(async () => openRouterRecordToRegistryEntry({ id: 'google/gemini-3.8-flash', name: 'Gemini',
      context_length: 1_048_576, top_provider: { max_completion_tokens: 65_536 } })!)
    const configured = buildJanusChatTurnPorts(baseDeps({ resolveModelMetadata,
      getProviderSettings: async () => ({ modelId: 'gemini-3.8-flash', extra: { chatModelLimits: { 'gemini-3.8-flash': { contextWindow: 1_000_000 } } } }),
    }))
    expect(await configured.model.resolve('vertex')).toMatchObject({ contextWindow: 1_048_576, maxOutputTokens: 65_536, source: 'registry' })
    expect(resolveModelMetadata).toHaveBeenCalledWith('gemini-3.8-flash')
    resolveModelMetadata.mockResolvedValue(undefined)
    const listed = buildJanusChatTurnPorts(baseDeps({ resolveModelMetadata,
      listModels: async () => [{ id: 'm1', contextWindow: 128_000, maxOutputTokens: 8192 }],
    }))
    expect(await listed.model.resolve('provider')).toMatchObject({ contextWindow: 128_000, source: 'catalog' })
    expect(resolveModelMetadata).toHaveBeenCalledWith('m1')
  })

  it.each([undefined, 128_000])('falls back after a catalog failure with adapter capacity %s', async contextWindow => {
    const ports = buildJanusChatTurnPorts(baseDeps({
      listModels: async () => [{ id: 'm1', contextWindow, maxOutputTokens: 4096 }],
      resolveModelMetadata: async () => { throw new Error('offline') },
    }))
    if (contextWindow) expect(await ports.model.resolve('provider')).toMatchObject({ contextWindow, source: 'catalog' })
    else await expect(ports.model.resolve('provider')).rejects.toThrow('MODEL_LIMITS_UNAVAILABLE')
  })

  it.each([undefined, 1_000_000])('uses the configured Gemini window in the actual compaction loop: %s', async contextWindow => {
    const modelId = 'gemini-3.8-flash'
    const summarize = vi.fn(async () => '## Goal\nPreserve the decision.\n## Progress\nDiscussed constraints.\n## Next Steps\nContinue.')
    const stream = vi.fn(async () => ({ textStream: (async function* () { yield 'Acknowledged' })() }))
    const ports = buildJanusChatTurnPorts(baseDeps({
      getProviderSettings: async () => ({ modelId, extra: { chatModelLimits: { [modelId]: { contextWindow, maxOutputTokens: 4096 } } } }),
      listModels: async () => [{ id: modelId, supportsFunctionCalling: true }],
      knowledgeSearch: undefined, captureObservation: undefined, streamTextFn: stream,
    }))
    const endpoint = await ports.model.resolve('vertex')
    expect(endpoint.contextWindow).toBe(contextWindow ?? 16_384)
    const messages = Array.from({ length: 31 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Decision ${index}: ` + 'rule '.repeat(1000) }))
    const session = new ManagedChatSession()
    session.beginTurn(messages, 'scope', undefined, () => {}, contextWindow ? 'configured' : 'estimated')
    await runChatTurn({ requestId: 'gemini-budget', providerId: 'vertex', messages, chatSession: session, compactionSummarizer: summarize }, ports)
    expect(stream).toHaveBeenCalledTimes(1)
    if (contextWindow) expect(summarize).not.toHaveBeenCalled()
    else expect(summarize).toHaveBeenCalled()
    expect(messages).toHaveLength(31)
  })

  it('resolves provider settings + language model + catalog flags', async () => {
    const ports = buildJanusChatTurnPorts(baseDeps({
      listModels: async () => [
        { id: 'm1', supportsFunctionCalling: true, contextWindow: 100_000, maxOutputTokens: 8_000 },
      ],
    }))
    const endpoint = await ports.model.resolve('p1')
    expect(endpoint.modelId).toBe('m1')
    expect(endpoint.model).toEqual({ fake: 'model' })
    expect(endpoint.supportsFunctionCalling).toBe(true)
    expect(endpoint.contextWindow).toBe(100_000)
    expect(endpoint.maxOutputTokens).toBe(8_000)
    expect(await ports.model.getMaxTurns()).toBe(40)
  })

  it('throws the pre-separation messages for missing provider/model', async () => {
    const noProvider = buildJanusChatTurnPorts(baseDeps({ getProviderSettings: async () => null }))
    await expect(noProvider.model.resolve('missing')).rejects.toThrow('Provider "missing" 未配置')
    const noModel = buildJanusChatTurnPorts(baseDeps({ getProviderSettings: async () => ({}) }))
    await expect(noModel.model.resolve('p1')).rejects.toThrow('No model ID configured')
  })

  it('passes an explicit function-calling=false through to the gate', async () => {
    const ports = buildJanusChatTurnPorts(baseDeps({
      listModels: async () => [{ id: 'm1', supportsFunctionCalling: false }],
    }))
    const endpoint = await ports.model.resolve('p1', 'm1')
    expect(endpoint.supportsFunctionCalling).toBe(false)
  })

  it('tolerates a failing model catalog like the inline version', async () => {
    const ports = buildJanusChatTurnPorts(baseDeps({
      listModels: async () => {
        throw new Error('catalog down')
      },
    }))
    const endpoint = await ports.model.resolve('p1')
    expect(endpoint.modelId).toBe('m1')
    expect(endpoint.supportsFunctionCalling).toBeUndefined()
  })

  it('skips the gate when the host has no catalog at all', async () => {
    const deps = baseDeps()
    delete deps.listModels
    const ports = buildJanusChatTurnPorts(deps)
    const endpoint = await ports.model.resolve('p1')
    expect(endpoint.modelId).toBe('m1')
    expect(endpoint.supportsFunctionCalling).toBeUndefined()
  })
})

describe('sessions port', () => {
  it('maps a running runtime session to a descriptor', () => {
    const ports = buildJanusChatTurnPorts(baseDeps({
      getAgentSession: (id) => id === 'sess-1' ? {
        id: 'sess-1',
        status: 'running',
        workspace: { workspaceId: 'ws1', workspaceRoot: 'C:/ws' },
      } : null,
    }))
    expect(ports.sessions.getSession('sess-1')).toEqual({
      sessionId: 'sess-1',
      workspaceId: 'ws1',
      workspaceRoot: 'C:/ws',
      status: 'running',
    })
    expect(ports.sessions.getSession('unknown')).toBeNull()
  })

  it('rejects unavailable sessions before any model call (parity)', async () => {
    const streamTextFn = vi.fn()
    const ports = buildJanusChatTurnPorts(baseDeps({
      getAgentSession: () => ({
        id: 'sess-9',
        status: 'stopped',
        workspace: { workspaceId: 'ws1', workspaceRoot: 'C:/ws' },
      }),
      streamTextFn: streamTextFn as JanusChatTurnPortsDeps['streamTextFn'],
    }))
    await expect(runChatTurn(
      {
        requestId: 'r1',
        messages: [{ role: 'user', content: 'hi' }],
        providerId: 'p1',
        sourceTag: 'janus-chat',
        workspaceResources: [{ workspaceId: 'ws1', agentSessionId: 'sess-9', workspaceName: 'w' }],
      },
      ports,
    )).rejects.toThrow('Attached workspace session is unavailable: ws1')
    expect(streamTextFn).not.toHaveBeenCalled()
  })
})

describe('tools port', () => {  it('threads callerId through and passes registry listings along', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = [{ name: 'workspace.read' }]
    const ports = buildJanusChatTurnPorts(baseDeps({
      executeFunctionCall: execute as unknown as JanusChatTurnPortsDeps['executeFunctionCall'],
      listRegistryTools: () => tools as unknown as ReturnType<JanusChatTurnPortsDeps['listRegistryTools']>,
      listRegistryManifests: () => [{ providerName: 'workspace' }] as unknown as ReturnType<JanusChatTurnPortsDeps['listRegistryManifests']>,
    }))
    const signal = new AbortController().signal
    await ports.tools.executeFunctionCall({ tool: 'x' } as never, 'renderer:7', signal)
    expect(execute).toHaveBeenCalledWith({ tool: 'x' }, 'renderer:7', signal)
    expect(ports.tools.registry.list()).toEqual(tools)
    expect(ports.tools.registry.listManifests?.()).toEqual([{ providerName: 'workspace' }])
  })
})

describe('knowledge ports', () => {
  it('skips disabled capture without failing a completed chat', async () => {
    const captureObservation = vi.fn(async () => { throw new Error('memory-capture-disabled') })
    const ports = buildJanusChatTurnPorts(baseDeps({ captureObservation }))
    await expect(ports.knowledgeCapture!.captureTurn({
      targets: [{ workspaceId: 'ws1', workspacePath: 'C:/ws', sessionId: 's1' }],
      userText: 'hello', assistantText: 'done', providerId: 'p', modelId: 'm', correlationId: 'r',
    })).resolves.toBeUndefined()
    expect(captureObservation).toHaveBeenCalledTimes(2)
  })

  it('still reports storage failures during capture', async () => {
    const ports = buildJanusChatTurnPorts(baseDeps({
      captureObservation: async () => { throw new Error('disk unavailable') },
    }))
    await expect(ports.knowledgeCapture!.captureTurn({
      targets: [{ workspaceId: 'ws1', workspacePath: 'C:/ws', sessionId: 's1' }],
      assistantText: 'done', providerId: 'p', modelId: 'm', correlationId: 'r',
    })).rejects.toThrow('disk unavailable')
  })

  it('delegates search with the facade query shape', async () => {
    const search = vi.fn(async () => ({ items: [] }) as unknown as KnowledgeContextResult)
    const ports = buildJanusChatTurnPorts(baseDeps({
      knowledgeSearch: search as unknown as NonNullable<ReturnType<typeof buildJanusChatTurnPorts>['knowledgeSearch']>,
    }))
    await ports.knowledgeSearch?.({
      query: 'q',
      workspaceId: 'ws1',
      workspacePath: 'C:/ws',
      maxItems: 5,
      maxChars: 3000,
    })
    expect(search).toHaveBeenCalledWith({
      query: 'q',
      workspaceId: 'ws1',
      workspacePath: 'C:/ws',
      maxItems: 5,
      maxChars: 3000,
    })
  })

  it('captures user + assistant turns with shell-identical payloads', async () => {
    const captured: unknown[] = []
    const settled: string[] = []
    const ports = buildJanusChatTurnPorts(baseDeps({
      captureObservation: async (input) => {
        captured.push(input)
        return { workspaceId: input.workspaceId }
      },
      scheduleSettled: (workspaceId) => {
        settled.push(workspaceId)
      },
    }))
    await ports.knowledgeCapture?.captureTurn({
      targets: [{ workspaceId: 'ws1', workspacePath: 'C:/ws', sessionId: 'sess-1' }],
      userText: 'hello',
      assistantText: 'world',
      providerId: 'p1',
      modelId: 'm1',
      correlationId: 'r1',
    })
    expect(captured).toHaveLength(2)
    expect(captured[0]).toMatchObject({
      workspaceId: 'ws1',
      source: 'janus-chat',
      type: 'conversation-turn',
      content: 'hello',
      summary: 'Janus Chat user message',
      tags: ['janus-chat', 'user'],
      actor: 'user',
      correlationId: 'r1',
      sessionId: 'sess-1',
    })
    expect(captured[1]).toMatchObject({
      content: 'world',
      summary: 'Janus Chat assistant response',
      tags: ['janus-chat', 'assistant'],
      actor: 'assistant',
      metadata: { providerId: 'p1', modelId: 'm1' },
    })
    await ports.knowledgeCapture?.notifySettled?.('ws1')
    expect(settled).toEqual(['ws1'])
  })

  it('falls back to the correlation id without a session and skips missing user text', async () => {    const captured: unknown[] = []
    const ports = buildJanusChatTurnPorts(baseDeps({
      captureObservation: async (input) => {
        captured.push(input)
        return null
      },
    }))
    await ports.knowledgeCapture?.captureTurn({
      targets: [{ workspaceId: 'ws1', workspacePath: 'C:/ws', sessionId: '' }],
      assistantText: 'world',
      providerId: 'p1',
      modelId: 'm1',
      correlationId: 'r9',
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ actor: 'assistant', sessionId: 'r9' })
  })

  it('falls back to person scope when capture targets are empty (workspace-free turn)', async () => {
    const captured: unknown[] = []
    const ports = buildJanusChatTurnPorts(baseDeps({
      captureObservation: async (input) => {
        captured.push(input)
        return { workspaceId: input.workspaceId }
      },
    }))
    await ports.knowledgeCapture?.captureTurn({
      targets: [],
      userText: 'remember this',
      assistantText: 'noted',
      providerId: 'p1',
      modelId: 'm1',
      correlationId: 'r-person',
    })
    expect(captured).toHaveLength(2)
    expect(captured[0]).toMatchObject({
      workspaceId: 'user',
      workspacePath: 'user',
      source: 'janus-chat',
      actor: 'user',
      sessionId: 'r-person',
    })
    expect(captured[1]).toMatchObject({ workspaceId: 'user', actor: 'assistant' })
  })
})

describe('question port', () => {
  it('passes the shell question bridge through untouched', async () => {
    const askUser = vi.fn(async () => ({ status: 'cancelled' as const }))
    const ports = buildJanusChatTurnPorts(baseDeps({ question: { askUser } }))
    expect(ports.question).toBeDefined()
    await ports.question?.askUser(
      { questions: [], allowCustom: false, callId: 'call-1' },
      new AbortController().signal,
    )
    expect(askUser).toHaveBeenCalledOnce()
  })

  it('leaves the port absent when the shell supplies no bridge (non-interactive deny)', () => {
    const ports = buildJanusChatTurnPorts(baseDeps())
    expect(ports.question).toBeUndefined()
  })
})
