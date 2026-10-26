import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'

const mocks = vi.hoisted(() => ({ provider: vi.fn(), model: vi.fn(), generate: vi.fn(), turn: vi.fn(), stream: vi.fn() }))
vi.mock('@janus-agent/janus-agent', () => ({ runChatTurn: mocks.turn }))
vi.mock('../../src/main/llm/LlmService', () => ({ llmService: { getProviderSettings: mocks.provider, getLanguageModel: mocks.model, initialize: async () => {} } }))
vi.mock('../../src/main/llm/ai-runtime', () => ({ generateText: mocks.generate, streamText: mocks.stream }))
vi.mock('../../src/main/llm/jev-credentials', () => ({ getJevKey: async () => null }))
import { checkReviewConfiguration, parseReviewAgentResult, reviewModelFailure, validatedReviewTurn, reviewStreamText } from '../../src/main/blueprint/review/models'
import type { ReviewEvidenceSession } from '../../plugins/blueprint/src/main/blueprint/review/evidence'

const settings = () => ({ ...structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), generation: { providerId: 'vertex', modelId: 'reasoning-model' } })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.turn.mockReset()
  mocks.provider.mockResolvedValue({ enabled: true })
  mocks.model.mockResolvedValue({})
  // Match a reasoning model that consumes its budget before writing visible text.
  mocks.generate.mockImplementation(async ({ maxTokens }) => maxTokens < 80 ? { finishReason: 'length', text: '' } : { finishReason: 'stop', text: 'OK' })
})

describe('review model connection checks', () => {
  it('accepts a completed JSON report after the agent corrects a failed source lookup', () => {
    expect(parseReviewAgentResult({ text: '{"findings":[],"coverage":"complete"}', cancelled: false,
      toolTraces: [{ status: 'failed' }, { status: 'completed' }] })).toMatchObject({ findings: [], coverage: 'complete' })
    expect(() => parseReviewAgentResult({ text: '{"findings":', cancelled: false, toolTraces: [] })).toThrowError(
      expect.objectContaining({ code: 'TRANSIENT' }),
    )
  })

  it('allows a reasoning model to complete the fixed probe', async () => {
    expect((await checkReviewConfiguration(settings())).generation.status).toBe('ready')
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ maxTokens: 1024, prompt: 'Connection test. Reply with OK.', maxRetries: 0 })
  })

  it.each(['initialization', 'request'])('returns a timeout when provider %s ignores cancellation', async stage => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    let finish!: (value: any) => void
    const stalled = new Promise(resolve => { finish = resolve })
    if (stage === 'initialization') mocks.model.mockReturnValueOnce(stalled)
    else mocks.generate.mockReturnValueOnce(stalled)
    try {
      const pending = checkReviewConfiguration(settings())
      await vi.waitFor(() => expect(stage === 'initialization' ? mocks.model : mocks.generate).toHaveBeenCalled())
      controller.abort(new DOMException('Connection test timed out', 'TimeoutError'))
      const result = await pending
      expect(result.generation).toMatchObject({ status: 'failed', reason: 'timeout' })
      finish(stage === 'initialization' ? {} : { finishReason: 'stop', text: 'OK' })
      await Promise.resolve()
      expect(result.generation.status).toBe('failed')
      if (stage === 'initialization') expect(mocks.generate).not.toHaveBeenCalled()
    } finally { timeout.mockRestore() }
  })

  it('identifies a truncated response without claiming invalid credentials', async () => {
    mocks.generate.mockResolvedValue({ finishReason: 'length', text: '' })
    expect((await checkReviewConfiguration(settings())).generation).toMatchObject({ status: 'failed', reason: 'truncated' })
  })

  it('distinguishes empty and blocked responses', async () => {
    mocks.generate.mockResolvedValueOnce({ finishReason: 'stop', text: ' ' })
    expect((await checkReviewConfiguration(settings())).generation.reason).toBe('empty-response')
    mocks.generate.mockResolvedValueOnce({ finishReason: 'content-filter', text: '' })
    expect((await checkReviewConfiguration(settings())).generation.reason).toBe('blocked')
  })

  it('reports missing selection and a disabled provider without sending a request', async () => {
    expect((await checkReviewConfiguration(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)).generation).toMatchObject({ status: 'missing', reason: 'not-configured' })
    mocks.provider.mockResolvedValue({ enabled: false })
    expect((await checkReviewConfiguration(settings())).generation).toMatchObject({ status: 'failed', reason: 'provider-unavailable' })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it.each([[401, 'authentication'], [403, 'forbidden'], [404, 'model-not-found'], [429, 'rate-limit'], [503, 'provider-error'], [400, 'invalid-request']])('classifies HTTP %s without exposing provider payloads', async (statusCode, reason) => {
    mocks.generate.mockRejectedValue(Object.assign(new Error('SECRET credential and request body'), { statusCode, responseBody: 'SECRET' }))
    const result = (await checkReviewConfiguration(settings())).generation
    expect(result).toMatchObject({ status: 'failed', reason, httpStatus: statusCode })
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('finds safe network and timeout reasons through wrapped causes', () => {
    expect(reviewModelFailure(new TypeError('fetch failed', { cause: Object.assign(new Error('SECRET'), { code: 'ENOTFOUND' }) }))).toMatchObject({ reason: 'network', code: 'TRANSIENT' })
    expect(reviewModelFailure(new DOMException('SECRET', 'TimeoutError'))).toMatchObject({ reason: 'timeout', code: 'TRANSIENT' })
    expect(reviewModelFailure({ code: 'MODEL_CREATION_ERROR', details: { cause: { statusCode: 403, message: 'SECRET' } } })).toMatchObject({ reason: 'forbidden', httpStatus: 403 })
  })

  it('unwraps exhausted SDK retries and normalized status without storing secrets', () => {
    const error = { name: 'AI_RetryError', message: 'SECRET', lastError: { statusCode: 503, responseBody: 'SECRET' } }
    expect(reviewModelFailure(error)).toMatchObject({ reason: 'provider-error', code: 'TRANSIENT', httpStatus: 503 })
    expect(reviewModelFailure({ status: 429 })).toMatchObject({ reason: 'rate-limit', code: 'TRANSIENT' })
    expect(reviewModelFailure(error).message).not.toContain('SECRET')
    expect(reviewModelFailure({ response: { status: 403 } })).toMatchObject({ reason: 'forbidden' })
    expect(reviewModelFailure({ error: { code: 503 } })).toMatchObject({ reason: 'provider-error' })
    expect(reviewModelFailure(new TypeError('Internal implementation failure'))).toMatchObject({ reason: 'unknown', code: 'MODEL_UNAVAILABLE' })
  })

  it('preserves provider status and discards partial text on a non-retryable stream failure', async () => {
    const failure = Object.assign(new Error('SECRET'), { statusCode: 401 })
    mocks.stream.mockReturnValue({ textStream: {}, toolCalls: Promise.resolve([]), fullStream: (async function* () {
      yield { type: 'text-delta', textDelta: 'partial' }
      yield { type: 'error', error: failure }
    })() })
    const received: unknown[] = []
    const consume = async () => { for await (const part of (await reviewStreamText({}, 4096)).fullStream) received.push(part) }
    await expect(consume()).rejects.toMatchObject({ reason: 'authentication', httpStatus: 401 })
    expect(received).toHaveLength(0)
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, maxTokens: 4096 }))
  })

  it('retries only an interrupted model request, without replaying partial text or SDK retries', async () => {
    vi.useFakeTimers()
    try {
      const failure = Object.assign(new Error('SECRET'), { statusCode: 503 })
      mocks.stream.mockReturnValueOnce({ fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: 'discard this' }; yield { type: 'error', error: failure }
      })() }).mockReturnValueOnce({ fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: 'complete report' }
      })() })
      const received: unknown[] = []
      const consume = (async () => { for await (const part of (await reviewStreamText({}, 4096)).fullStream) received.push(part) })()
      await vi.advanceTimersByTimeAsync(2000)
      await consume
      expect(mocks.stream).toHaveBeenCalledTimes(2)
      expect(received).toEqual([{ type: 'text-delta', textDelta: 'complete report' }])
    } finally { vi.useRealTimers() }
  })

  it('stops a cancelled request during backoff without another network call', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      mocks.stream.mockRejectedValue(Object.assign(new Error('SECRET'), { statusCode: 503 }))
      const consume = (async () => { for await (const _part of (await reviewStreamText({ abortSignal: controller.signal }, 4096)).fullStream) { /* drain */ } })()
      const failed = expect(consume).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      await failed
      expect(mocks.stream).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('stops persistent transport failures after two requests and preserves safe classification', async () => {
    vi.useFakeTimers()
    try {
      mocks.stream.mockRejectedValue(Object.assign(new Error('SECRET'), { statusCode: 503 }))
      const consume = (async () => { for await (const _part of (await reviewStreamText({}, 4096)).fullStream) { /* drain */ } })()
      const failed = expect(consume).rejects.toMatchObject({ reason: 'provider-error', code: 'TRANSIENT', httpStatus: 503 })
      await vi.advanceTimersByTimeAsync(10_000)
      await failed
      expect(mocks.stream).toHaveBeenCalledTimes(2)
      const classified = reviewModelFailure({ lastError: { statusCode: 503, message: 'SECRET' } })
      expect(reviewModelFailure(classified)).toBe(classified)
      expect(classified.message).not.toContain('SECRET')
    } finally { vi.useRealTimers() }
  })

  it.each([
    ['MODEL_LIMITS_UNAVAILABLE: SECRET', 'model-capacity'],
    ['CURRENT_CONTEXT_EXCEEDS_BUDGET: SECRET', 'context-limit'],
    ['SYSTEM_CONTEXT_EXCEEDS_BUDGET', 'context-limit'],
  ])('preserves the actionable category for %s', (message, reason) => {
    const result = reviewModelFailure(new Error(message))
    expect(result).toMatchObject({ reason, code: 'MODEL_UNAVAILABLE' })
    expect(result.message).not.toContain('SECRET')
  })

  it('corrects a bad citation once in the same evidence session and retains the finding', async () => {
    const finding = { id: '00000000-0000-4000-8000-000000000001', category: 'contradiction', summary: 'Mismatch',
      explanation: 'The source contradicts this claim.', suggestion: 'Update the claim.', verification: 'not-configured',
      citations: [{ path: 'src/a.ts', quote: 'invented' }] }
    const report = { findings: [finding], coverage: 'complete', limitations: [] }
    mocks.turn.mockResolvedValueOnce({ text: JSON.stringify(report), cancelled: false, toolTraces: [] })
      .mockResolvedValueOnce({ text: JSON.stringify({ ...report, findings: [{ ...finding, citations: [{ path: 'src/a.ts', quote: 'actual' }] }] }), cancelled: false, toolTraces: [] })
    const evidence = { input: { materials: [{ path: 'src/a.ts', content: 'actual' }] }, validateTargetRead: vi.fn(), validateCoverage: vi.fn() } as unknown as ReviewEvidenceSession
    const result = await validatedReviewTurn({ messages: [{ role: 'user', content: 'Review' }] } as never, {} as never, evidence, new AbortController().signal)
    expect(result.findings).toHaveLength(1)
    expect(mocks.turn).toHaveBeenCalledTimes(2)
    expect(mocks.turn.mock.calls[1][0].messages.at(-1).content).toContain('Citation quote does not match')
  })

  it('stops after one report correction and never retries authentication failures', async () => {
    const evidence = { input: { materials: [] }, validateTargetRead: vi.fn(), validateCoverage: vi.fn() } as unknown as ReviewEvidenceSession
    mocks.turn.mockResolvedValue({ text: 'invalid JSON', cancelled: false, toolTraces: [] })
    await expect(validatedReviewTurn({ messages: [] } as never, {} as never, evidence, new AbortController().signal)).rejects.toThrow('valid JSON')
    expect(mocks.turn).toHaveBeenCalledTimes(2)
    mocks.turn.mockReset().mockRejectedValue({ statusCode: 401 })
    await expect(validatedReviewTurn({ messages: [] } as never, {} as never, evidence, new AbortController().signal)).rejects.toMatchObject({ reason: 'authentication' })
    expect(mocks.turn).toHaveBeenCalledTimes(1)
  })
})
