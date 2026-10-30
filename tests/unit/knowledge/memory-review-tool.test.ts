import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../../src/renderer/src/i18n/locales/en/knowledge.json'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadReviewCandidates, MemoryReviewCard } from '../../../src/renderer/src/components/knowledge/MemoryReviewTool'
import type { CandidateFact } from '../../../src/shared/knowledge'
import { countInboxScopes, filterInboxByScope } from '../../../src/renderer/src/components/knowledge/inboxScope'

function fact(id: string, scope: 'user' | 'project'): CandidateFact {
  return {
    id, type: 'fact', status: 'proposed', derivation: 'deterministic',
    evidence: { observationIds: ['obs-1'], sources: [{ observationId: 'obs-1', workspaceId: 'source-project', scope: 'project', source: 'manual', createdAt: '2026-09-28', speaker: 'user', authority: 'user-stated', excerpt: '<script>user original</script>' }] },
    fact: { id: `fact-${id}`, scope, content: 'Prefer pnpm', kind: 'preference', confidence: 0.6, status: 'proposed', version: 1, concepts: [], files: [], tags: [], supersedes: 'old-fact', provenance: { workspaceId: 'user', workspaceName: 'user', workspacePath: '', source: 'manual', sourceObservationIds: ['obs-1'], fileRefs: [], actor: 'test', createdAt: '2026-09-28' } },
    conflicts: ['conflicting-fact'],
  }
}

beforeAll(async () => { await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { knowledge: en } }, interpolation: { escapeValue: false } }) })

afterEach(() => vi.unstubAllGlobals())

describe('unified memory review', () => {
  it('shows window-specific source ranges and probabilities without a whole-source confidence', () => {
    const candidate = fact('chunked', 'user')
    candidate.decision = { version: 1, scorer: { provider: 'legacy-scorer', modelRevision: 'fixture', templateVersion: 'memory-decision/1', calibrationId: null },
      inputHash: 'hash', candidateHash: 'hash', createdAt: '2026-09-29', status: 'ready', route: 'review', reason: 'cross-chunk-conflict',
      answers: [], evidenceRanges: [{ observationId: 'obs-1', start: 0, end: 1000 }], relatedFactIds: [], truncated: false,
      chunks: [{ evidenceRanges: [{ observationId: 'obs-1', start: 0, end: 800 }], answers: [{ question: 'support', answer: true, answer_confidence: .98, distribution: { true: .98, false: .02 }, noul: .98 }] },
        { evidenceRanges: [{ observationId: 'obs-1', start: 672, end: 1000 }], answers: [{ question: 'support', answer: false, answer_confidence: .99, distribution: { true: .01, false: .99 }, noul: .01 }] }],
    }
    const markup = renderToStaticMarkup(createElement(MemoryReviewCard, { candidate, disabled: false, onReview: vi.fn() }))
    expect(markup).toContain('obs-1 [0, 800)')
    expect(markup).toContain('obs-1 [672, 1000)')
    expect(markup).toContain('support: true (98%)')
    expect(markup).toContain('support: false (99%)')
  })
  it('shows the previous and proposed values and competing correction warning', () => {
    const candidate = fact('correction', 'user')
    candidate.fact.content = 'Prefer npm'
    candidate.personalCorrection = { targetId: 'original', targetHash: 'hash', previousContent: 'Prefer pnpm' }
    const markup = renderToStaticMarkup(createElement(MemoryReviewCard, { candidate, competing: 1, disabled: false, onReview: vi.fn() }))
    expect(markup).toContain('Prefer pnpm')
    expect(markup).toContain('Prefer npm')
    expect(markup).toContain('approval replaces the original')
    expect(markup).toContain('1 other corrections')
  })
  it('keeps private engineering-derived memory in the personal filter and displays escaped original evidence', () => {
    const candidate = fact('personal', 'user')
    const markup = renderToStaticMarkup(createElement(MemoryReviewCard, { candidate, disabled: false, onReview: vi.fn() }))
    expect(filterInboxByScope([candidate], 'engineering')).toEqual([])
    expect(markup).toContain('source-project')
    expect(markup).toContain('&lt;script&gt;user original&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('old-fact')
    expect(markup).toContain('conflicting-fact')
    expect(markup).toContain('Janus')
    expect(markup).toContain('MCP')
  })

  it('disables both review actions while a mutation or load failure is unresolved', () => {
    const markup = renderToStaticMarkup(createElement(MemoryReviewCard, { candidate: fact('a', 'user'), disabled: true, onReview: vi.fn() }))
    for (const label of ['Approve', 'Reject', 'Refresh conflict check']) {
      expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`))
    }
  })

  it('loads both domains, excludes terminal candidates and computes independent counts', async () => {
    const personal = fact('personal', 'user')
    const engineering = fact('engineering', 'project')
    engineering.fact.provenance.workspaceId = 'project-a'
    const applied = { ...personal, id: 'done', status: 'applied' }
    vi.stubGlobal('window', { electron: { knowledge: {
      listCandidates: vi.fn().mockResolvedValue([personal, engineering, applied]),
      listWikiPatchCandidates: vi.fn().mockResolvedValue([]),
      listGraphCandidates: vi.fn().mockResolvedValue([]),
    } } })
    const result = await loadReviewCandidates()
    expect(result.map(candidate => candidate.id)).toEqual(['personal'])
    expect(countInboxScopes(result)).toEqual({ user: 1, engineering: 0 })
  })

  it('rejects partial reads instead of showing a misleading empty or incomplete queue', async () => {
    vi.stubGlobal('window', { electron: { knowledge: {
      listCandidates: vi.fn().mockRejectedValue(new Error('unavailable')),
      listWikiPatchCandidates: vi.fn().mockRejectedValue(new Error('unavailable')),
      listGraphCandidates: vi.fn().mockResolvedValue([]),
    } } })
    await expect(loadReviewCandidates()).rejects.toThrow('unavailable')
  })
})
