import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSessionRuntime, estimateContextTokens } from '@janus-agent/chat-core'
import { buildProposalContext, proposalModelBudget } from '../../plugins/blueprint/src/main/janus/maintenance/proposal-context'
import { blueprintNodeContext } from '../../plugins/blueprint/src/main/janus/maintenance/blueprint-tools'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'

afterEach(() => vi.restoreAllMocks())

describe('proposal context admission', () => {
  const source = '# 完整需求\n' + '保留验收要求和边界。'.repeat(300)
  const conversation = 'user: Do not delete existing requirements.\nassistant: Understood.\nuser: Revise only the title.'
  const base = () => ({
    modelId: 'custom-unknown', model: proposalModelBudget('custom-unknown'),
    system: 'Generate a reviewable proposal only.', schemaTokens: 1200,
    required: [{ label: 'Conversation', content: conversation }, { label: 'Note source', content: source }],
    optional: [] as Array<{ label: string; content: string }>,
  })

  it('reproduces the real overflow and drops 240 KB of auxiliary code without losing Notes or early user constraints', () => {
    const evidence = 'A'.repeat(240 * 1024)
    expect(() => new ChatSessionRuntime().buildContext([{ role: 'user', content: conversation + source + evidence }])).toThrow('CURRENT_CONTEXT_EXCEEDS_BUDGET')
    const input = { ...base(), optional: [{ label: 'Workspace evidence ws-1', content: evidence }, { label: 'Small evidence', content: 'src/value.ts: export const value = 1' }] }
    const result = buildProposalContext(input)
    expect(result.content).toContain(source)
    expect(result.content).toContain(conversation)
    expect(result.content).not.toContain(evidence)
    expect(result.content).toContain('export const value = 1')
    expect(result.omitted).toEqual(['Workspace evidence ws-1'])
    expect(result.content).toContain('Its contents were NOT read')
    expect(() => new ChatSessionRuntime().buildContext([
      { role: 'system', content: input.system }, { role: 'user', content: result.content },
    ], { model: { contextWindow: 65536 }, toolTokens: input.schemaTokens })).not.toThrow()
  })

  it('uses reliable registry metadata for a custom provider alias absent from its short model list', () => {
    const model = proposalModelBudget('claude-sonnet-4.6')
    expect(model.contextWindow).toBeGreaterThan(16384)
    const content = '中文需求'.repeat(6000)
    const input = { ...base(), model, required: [{ label: 'Note source', content }] }
    expect(buildProposalContext(input).content).toContain(content)
    expect(proposalModelBudget('claude-sonnet-4.6', { contextWindow: 8192, maxOutputTokens: 1000 }).contextWindow).toBe(8192)
    expect(proposalModelBudget('unknown-model-abcdef').contextWindow).toBeUndefined()
  })

  it('refuses genuinely oversized necessary source with component sizes instead of truncating it', () => {
    const content = '中文'.repeat(40000)
    expect(() => buildProposalContext({ ...base(), required: [{ label: 'Note source', content }] }))
      .toThrow(`Note source ≈ ${estimateContextTokens(content)} tokens`)
  })

  it('counts the actual system and schema rather than only checking user content', () => {
    expect(() => buildProposalContext({ ...base(), model: { contextWindow: 16384 }, system: '中'.repeat(14000) })).toThrow('必要上下文')
    expect(() => buildProposalContext({ ...base(), model: { contextWindow: 16384 }, schemaTokens: 14000 })).toThrow('必要上下文')
  })

  it('admits the reported unknown Gemini input intact without imposing a 16K model window', () => {
    const required = [143, 2354, 2, 91, 8917].map((size, index) => ({ label: `Section ${index}`, content: '中'.repeat(size) }))
    const input = { ...base(), modelId: 'gemini-3.8-flash', system: 'System instructions '.repeat(100), schemaTokens: 4096, required,
      optional: [{ label: 'Repository', content: 'x'.repeat(240 * 1024) }] }
    const result = buildProposalContext(input)
    for (const section of required) expect(result.content).toContain(section.content)
    expect(result.omitted).toEqual(['Repository'])
    expect(() => buildProposalContext({ ...input, model: { contextWindow: 16384 } })).toThrow('窗口 16384')
    expect(() => buildProposalContext({ ...input, required: [{ label: 'Large source', content: '中'.repeat(70000) }] }))
      .toThrow('应用单次请求上限 65536 tokens（不是模型窗口）')
  })

  it('keeps all auxiliary evidence when it fits', () => {
    const result = buildProposalContext({ ...base(), optional: [{ label: 'Workspace evidence', content: 'Complete small file' }] })
    expect(result.content).toContain('Complete small file')
    expect(result.omitted).toEqual([])
    expect(result.content).not.toContain('Auxiliary context omitted')
  })

  it('does not reject a fitting prompt because an unnecessary omission notice would be larger', () => {
    const result = buildProposalContext({ ...base(), system: 's', schemaTokens: 0,
      model: { contextWindow: 4096, maxOutputTokens: 100 },
      required: [{ label: 'Source', content: 'a'.repeat(3440 * 4) }],
      optional: [{ label: 'Evidence', content: 'small' }],
    })
    expect(result.omitted).toEqual([])
    expect(result.content).toContain('small')
  })

  it('does not mislabel runtime failures as Note size errors', () => {
    const error = new Error('Unexpected runtime defect')
    vi.spyOn(ChatSessionRuntime.prototype, 'buildContext').mockImplementation(() => { throw error })
    expect(() => buildProposalContext(base())).toThrow(error)
  })

  it('does not repeat projected prose when raw Note source is supplied', () => {
    const blueprint = { nodes: { n: { id: 'n', title: 'Title', description: source, notes: source, sourceUri: 'note://repo/n', children: [] } }, relations: [] } as unknown as Blueprint
    const full = blueprintNodeContext(blueprint, new Set(['n']))
    const compact = blueprintNodeContext(blueprint, new Set(['n']), false)
    expect(full).toContain('完整需求')
    expect(compact).not.toContain('完整需求')
    expect(JSON.parse(compact).nodes[0]).toMatchObject({ id: 'n', title: 'Title', sourceUri: 'note://repo/n' })
  })
})
