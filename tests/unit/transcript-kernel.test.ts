import { describe, expect, it } from 'vitest'
import {
  cleanPromptText,
  extractKernelMessages,
  firstCleanPrompt,
  isEnvironmentInjectionText,
  pairTurns,
  segmentTurns,
} from '../../src/main/sessions/transcript-kernel'

function claudeRecord(type: string, content: unknown, extra: Record<string, unknown> = {}) {
  return { type, message: { role: type, content }, sessionId: 's', cwd: 'C:/repo', ...extra }
}

describe('transcript kernel', () => {
  it('drops claude meta, sidechain and compaction records', () => {
    const lines = [
      JSON.stringify(claudeUser('real question')),
      JSON.stringify(claudeUser('subagent instruction', { isSidechain: true })),
      JSON.stringify(claudeAssistant('sidechain answer', { isSidechain: true })),
      JSON.stringify(claudeUser('meta noise', { isMeta: true })),
      JSON.stringify(claudeUser('compacted summary', { isCompactSummary: true })),
      JSON.stringify(claudeAssistant('real answer')),
    ]
    const messages = extractKernelMessages(lines, 'claude')
    expect(messages).toEqual([
      { role: 'user', text: 'real question', timestamp: undefined },
      { role: 'assistant', text: 'real answer', timestamp: undefined },
    ])
    expect(pairTurns(messages)).toEqual([{ prompt: 'real question', excerpt: 'real answer' }])
    expect(firstCleanPrompt(messages)).toBe('real question')
  })

  function claudeUser(text: string, extra: Record<string, unknown> = {}) {
    return claudeRecord('user', text, extra)
  }

  function claudeAssistant(text: string, extra: Record<string, unknown> = {}) {
    return claudeRecord('assistant', [{ type: 'text', text }], extra)
  }

  it('keeps text blocks only and joins them with newlines', () => {
    const record = claudeRecord('assistant', [
      { type: 'thinking', thinking: 'hidden' },
      { type: 'text', text: 'line one' },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      { type: 'text', text: 'line two' },
    ])
    const messages = extractKernelMessages([JSON.stringify(record)], 'claude')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('line one\nline two')
  })

  it('collapses codex event_msg mirrors into their source records', () => {
    const lines = [
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'q' }] } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'q' } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: 'a' }] } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'a' } }),
    ]
    const messages = extractKernelMessages(lines, 'codex')
    expect(messages).toHaveLength(2)
    expect(pairTurns(messages)).toEqual([{ prompt: 'q', excerpt: 'a' }])
  })

  it('keeps mirrors when a codex file has no source records', () => {
    const lines = [
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'q' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'a' } }),
    ]
    expect(pairTurns(extractKernelMessages(lines, 'codex'))).toEqual([{ prompt: 'q', excerpt: 'a' }])
  })

  it('drops codex AGENTS.md injections and keeps marked user input', () => {
    const injection = {
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for C:\\repo\n\n<INSTRUCTIONS>\nwhatever\n</INSTRUCTIONS>' }] },
      metadata: {},
    }
    const real = {
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '创建一个 HTML 动画' }] },
      metadata: { user_input_order: 0, retained_source: { revision: 'retained_x' } },
    }
    const answer = {
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好的' }] },
      metadata: { user_input_order: 0 },
    }
    const messages = extractKernelMessages(
      [injection, real, answer].map((record) => JSON.stringify(record)),
      'codex',
    )
    expect(messages).toEqual([
      { role: 'user', text: '创建一个 HTML 动画', timestamp: undefined },
      { role: 'assistant', text: '好的', timestamp: undefined },
    ])
    expect(firstCleanPrompt(messages)).toBe('创建一个 HTML 动画')
  })

  it.each([
    ['# AGENTS.md instructions\n\n<INSTRUCTIONS>\nnoise', undefined],
    ['# AGENTS.md instructions\r\n\r\n<INSTRUCTIONS>\nnoise', {}],
    ['# AGENTS.md instructions', { user_input_order: 0 }],
    ['# AGENTS.md instructions for C:\\repo\n\n<INSTRUCTIONS>\nnoise', undefined],
  ])('drops instruction header %s independently of metadata', (text, metadata) => {
    const messages = extractKernelMessages([
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: text }, metadata }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'real question' }, metadata: { user_input_order: 0 } }),
    ], 'codex')
    expect(messages).toEqual([{ role: 'user', text: 'real question' }])
  })

  it('keeps ordinary questions mentioning AGENTS.md instructions', () => {
    for (const text of ['Explain AGENTS.md instructions', '# AGENTS.md instructions need updating']) {
      expect(isEnvironmentInjectionText(text)).toBe(false)
    }
  })

  it('falls back to content heuristics for legacy codex records without metadata', () => {
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<ENVIRONMENT_CONTEXT>\nworkspace stuff' }] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for C:\\repo' }] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { role: 'user', content: '# AGENTS.md instructions\n\n<INSTRUCTIONS>\nnoise' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'real legacy question' }] },
      }),
    ]
    const messages = extractKernelMessages(lines, 'codex')
    expect(firstCleanPrompt(messages)).toBe('real legacy question')
  })

  it('keeps re-registered large inputs whose metadata lacks user_input_order', () => {
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for C:\\repo' }] },
        metadata: {},
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'big pasted spec' }] },
        metadata: { client_authored: false, fallback_token_limit_override: 12000 },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'later question' }] },
        metadata: { user_input_order: 0, retained_source: { revision: 'retained_1' } },
      }),
    ]
    const messages = extractKernelMessages(lines, 'codex')
    expect(messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual([
      'big pasted spec',
      'later question',
    ])
  })

  it('merges consecutive assistant records into one turn per question', () => {
    const lines = [
      JSON.stringify(claudeUser('build it')),
      JSON.stringify(claudeAssistant('step one')),
      JSON.stringify(claudeRecord('assistant', [{ type: 'tool_use', name: 'Bash', input: {} }])),
      JSON.stringify(claudeAssistant('step two')),
      JSON.stringify(claudeUser('ship it')),
      JSON.stringify(claudeAssistant('shipped')),
    ]
    const turns = pairTurns(extractKernelMessages(lines, 'claude'))
    expect(turns).toEqual([
      { prompt: 'build it', excerpt: 'step one\nstep two' },
      { prompt: 'ship it', excerpt: 'shipped' },
    ])
  })

  it('cleans wrapper noise from first prompts', () => {
    expect(cleanPromptText('<command-name>/clear</command-name>')).toBe('')
    expect(cleanPromptText('[Request interrupted by user]')).toBe('')
    expect(
      cleanPromptText('<system-reminder>noise</system-reminder>real question'),
    ).toBe('real question')
    const lines = [
      JSON.stringify(claudeUser('<command-name>compact</command-name>')),
      JSON.stringify(claudeUser('real question')),
    ]
    expect(firstCleanPrompt(extractKernelMessages(lines, 'claude'))).toBe('real question')
  })

  it('never pairs across a windowed read gap', () => {
    const lines = [
      JSON.stringify(claudeUser('head question')),
      JSON.stringify(claudeAssistant('head answer')),
      JSON.stringify(claudeUser('tail question')),
      JSON.stringify(claudeAssistant('tail answer')),
    ]
    // headLines 2 keeps the first pair in the head segment and the second in
    // the tail segment; nothing crosses the gap.
    expect(segmentTurns(lines, 2, 'claude')).toEqual([
      { prompt: 'head question', excerpt: 'head answer' },
      { prompt: 'tail question', excerpt: 'tail answer' },
    ])
    // A gap between a lone question and a lone answer keeps them two partial
    // turns instead of one fabricated pair.
    expect(segmentTurns(lines, 1, 'claude')).toEqual([
      { prompt: 'head question' },
      { excerpt: 'head answer' },
      { prompt: 'tail question', excerpt: 'tail answer' },
    ])
  })
})
