import { describe, expect, it, vi } from 'vitest'
import { DECISION_TEMPLATE_VERSION, NoopScorer, scoreMemoryDecision, type DecisionScorer, type MemoryDecisionInput } from '../../../src/main/knowledge/decision-scorer'

const input: MemoryDecisionInput = {
  candidateId: 'candidate', candidateHash: 'hash', scope: 'project', workspaceId: 'project',
  content: 'Use Postgres.', kind: 'decision', truncated: false, relatedFacts: [],
  evidence: [{ observationId: 'o1', start: 0, end: 13, text: 'Use Postgres.', source: {
    observationId: 'o1', workspaceId: 'project', scope: 'project', source: 'manual', speaker: 'user',
    authority: 'user-stated', createdAt: '2026-09-28T00:00:00Z', excerpt: 'Use Postgres.',
  } }],
}

export function readyAnswers(refine = false) {
  return ['retention', 'kind', 'support', 'duplicate', 'supersede', 'conflict'].map((question) => {
    if (question === 'kind') return { question, answer: 'decision', answer_confidence: 0.97,
      distribution: { fact: 0.01, decision: 0.97, preference: 0.01, procedure: 0.01 } }
    const answer = question === 'retention' || question === 'support'
    const selected = refine && question === 'support' ? 0.6 : 0.98
    const noul = answer ? selected : 1 - selected
    return { question, answer, answer_confidence: selected, noul, distribution: { true: noul, false: 1 - noul } }
  })
}

function scorer(output: unknown): DecisionScorer {
  return { identity: { provider: 'test-scorer', modelRevision: 'pinned', templateVersion: DECISION_TEMPLATE_VERSION, calibrationId: null },
    score: vi.fn(async () => output) }
}

describe('memory decision scorer validation', () => {
  function longInput(text = '项目说明。'.repeat(400)): MemoryDecisionInput {
    return { ...input, evidence: [{ ...input.evidence[0]!, text, end: text.length }] }
  }

  it('covers long evidence with overlapping source ranges and no aggregate probability', async () => {
    const text = '🙂项目决定使用 Postgres。'.repeat(160)
    const model = scorer({ status: 'ready', answers: readyAnswers() })
    const result = await scoreMemoryDecision(longInput(text), model)
    expect(result).toMatchObject({ status: 'ready', route: 'review', reason: 'chunked-review', answers: [], truncated: false })
    let covered = 0
    for (const [chunk] of vi.mocked(model.score).mock.calls) {
      const evidence = chunk.evidence[0]!
      expect(evidence.start).toBeLessThanOrEqual(covered)
      expect(evidence.text).toBe(text.slice(evidence.start, evidence.end))
      expect(evidence.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      covered = evidence.end
    }
    expect(covered).toBe(text.length)
    expect(result.chunks).toHaveLength(vi.mocked(model.score).mock.calls.length)
  })

  it('sends contradictory windows to human review even with high probabilities', async () => {
    const model = scorer({ status: 'ready', answers: readyAnswers() })
    const disagree = readyAnswers().map(answer => answer.question === 'support' ? { ...answer, answer: false, noul: .02, distribution: { true: .02, false: .98 } } : answer)
    vi.mocked(model.score).mockResolvedValueOnce({ status: 'ready', answers: disagree })
    expect(await scoreMemoryDecision(longInput(), model)).toMatchObject({ status: 'ready', reason: 'cross-chunk-conflict', route: 'review', answers: [] })
  })

  it('refuses unbounded chunks and partial scoring without manufacturing a ready result', async () => {
    const model = scorer({ status: 'ready', answers: readyAnswers() })
    expect(await scoreMemoryDecision(longInput('x'.repeat(30000)), model)).toMatchObject({ reason: 'chunk-budget-exceeded', route: 'review' })
    expect(model.score).not.toHaveBeenCalled()
    vi.mocked(model.score).mockResolvedValueOnce({ status: 'ready', answers: readyAnswers() }).mockResolvedValueOnce({ status: 'unavailable' })
    expect(await scoreMemoryDecision(longInput(), model)).toMatchObject({ status: 'unavailable', answers: [], route: 'review' })
  })

  it('keeps unavailable scoring on the manual path with traceable host evidence', async () => {
    const result = await scoreMemoryDecision(input, new NoopScorer())
    expect(result).toMatchObject({ status: 'unavailable', route: 'review', evidenceRanges: [{ observationId: 'o1', start: 0, end: 13 }] })
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('interprets high-confidence false noul answers as non-duplicates, not duplicates', async () => {
    const result = await scoreMemoryDecision(input, scorer({ status: 'ready', answers: readyAnswers() }))
    expect(result).toMatchObject({ status: 'ready', route: 'review', reason: 'consistent-review' })
    expect(result.answers.find((answer) => answer.question === 'duplicate')).toMatchObject({ answer: false, answer_confidence: 0.98 })
  })

  it('routes valid uncertain evidence to refinement without trusting entropy confidence', async () => {
    const answers = readyAnswers(true).map((answer) => ({ ...answer, confidence: 1, act_probability: 1 }))
    expect(await scoreMemoryDecision(input, scorer({ status: 'ready', answers }))).toMatchObject({ status: 'ready', route: 'refine' })
  })

  it.each(['missing', 'duplicate', 'nan', 'noul-direction', 'folded-options', 'wrong-probability', 'not-most-likely'])('rejects %s output', async (defect) => {
    const answers: Array<Record<string, unknown>> = readyAnswers()
    if (defect === 'missing') answers.pop()
    if (defect === 'duplicate') answers[0] = answers[1]!
    if (defect === 'nan') answers[0]!.answer_confidence = NaN
    if (defect === 'noul-direction') answers[3]!.noul = 0.98
    if (defect === 'folded-options') answers[1]!.distribution = { decision: 1 }
    if (defect === 'wrong-probability') answers[0]!.answer_confidence = 0.9
    if (defect === 'not-most-likely') answers[0] = { question: 'retention', answer: false, answer_confidence: 0.02, noul: 0.98, distribution: { true: 0.98, false: 0.02 } }
    expect(await scoreMemoryDecision(input, scorer({ status: 'ready', answers }))).toMatchObject({ status: 'unavailable', route: 'review', reason: 'invalid-output' })
  })

  it('aborts hanging scorers and ignores late completion', async () => {
    let signal: AbortSignal | undefined
    const hanging = scorer(null)
    hanging.score = async (_input, abortSignal) => { signal = abortSignal; return new Promise(() => {}) }
    expect(await scoreMemoryDecision(input, hanging, 5)).toMatchObject({ route: 'review', reason: 'scorer-timeout' })
    expect(signal?.aborted).toBe(true)
  })

  it('contains scorer errors and does not score incomplete evidence', async () => {
    const broken = scorer(null)
    broken.score = vi.fn(async () => { throw new Error('offline') })
    expect(await scoreMemoryDecision(input, broken)).toMatchObject({ reason: 'scorer-error', route: 'review' })
    vi.mocked(broken.score).mockClear()
    expect(await scoreMemoryDecision({ ...input, truncated: true }, broken)).toMatchObject({ reason: 'incomplete-context' })
    expect(broken.score).not.toHaveBeenCalled()
  })

  it('pins the template and model identity into the input hash', async () => {
    const model = scorer({ status: 'ready', answers: readyAnswers() })
    const first = await scoreMemoryDecision(input, model)
    model.identity.modelRevision = 'new-model'
    expect((await scoreMemoryDecision(input, model)).inputHash).not.toBe(first.inputHash)
    model.identity.templateVersion = 'wrong-template'
    expect(await scoreMemoryDecision(input, model)).toMatchObject({ reason: 'template-mismatch', route: 'review' })
  })
})
