import { describe, it, expect, beforeEach } from 'vitest'

describe('DshParser', () => {
  let DshParser: new () => { parseLine(json: Record<string, unknown>): import('../../../src/main/janus-runner/types').AgentEvent[]; reset(): void }

  beforeEach(async () => {
    const mod = await import('../../../src/main/janus-runner/parsers/dsh-parser')
    DshParser = mod.DshParser
  })

  // --- text / thinking events (verified against dsh 0.2.0-rc.2 --json) ---

  describe('text events', () => {
    it('should emit text-chunk for a committed text block', () => {
      const parser = new DshParser()
      const events = parser.parseLine({ type: 'text', text: 'Hello from DeepSeek' })
      expect(events).toEqual([{ type: 'text-chunk', text: 'Hello from DeepSeek' }])
    })

    it('should not emit event when text is missing or empty', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ type: 'text' })).toEqual([])
      expect(parser.parseLine({ type: 'text', text: '' })).toEqual([])
    })

    it('should emit a thinking phase with a bounded label', () => {
      const parser = new DshParser()
      const events = parser.parseLine({ type: 'thinking', text: 'x'.repeat(500) })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'phase', phase: 'thinking' })
      const label = (events[0] as { label?: string }).label ?? ''
      expect(label.length).toBeLessThanOrEqual(201)
      expect(label.endsWith('…')).toBe(true)
    })

    it('should keep short thinking text verbatim', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ type: 'thinking', text: 'considering options' })).toEqual([
        { type: 'phase', phase: 'thinking', label: 'considering options' },
      ])
    })
  })

  // --- tool events ---

  describe('tool events', () => {
    it('should emit tool-start for tool_call with command input', () => {
      const parser = new DshParser()
      const events = parser.parseLine({
        type: 'tool_call',
        callId: 'call-1',
        tool: 'bash',
        input: { command: 'ls -la' },
      })
      expect(events).toEqual([
        { type: 'tool-start', id: 'call-1', name: 'bash', arg: 'ls -la', filePath: undefined },
      ])
    })

    it.each([
      [{ path: '/src/index.ts' }, '/src/index.ts', '/src/index.ts'],
      [{ filePath: '/src/a.ts', command: 'ls' }, 'ls', '/src/a.ts'],
      [{ query: 'TODO' }, 'TODO', undefined],
      [{ description: 'read docs' }, 'read docs', undefined],
      [{}, '', undefined],
    ] as const)('should extract arg/filePath from %s', (input, expectedArg, expectedFile) => {
      const parser = new DshParser()
      const events = parser.parseLine({ type: 'tool_call', callId: 'c', tool: 'read', input })
      expect(events).toEqual([
        { type: 'tool-start', id: 'c', name: 'read', arg: expectedArg, filePath: expectedFile },
      ])
    })

    it('should fall back to unknown tool and timestamp id', () => {
      const parser = new DshParser()
      const before = Date.now()
      const events = parser.parseLine({ type: 'tool_call' })
      const after = Date.now()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'tool-start', name: 'unknown', arg: '' })
      const id = Number((events[0] as { id: string }).id)
      expect(id).toBeGreaterThanOrEqual(before)
      expect(id).toBeLessThanOrEqual(after)
    })

    it('should emit tool-end for tool_result', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ type: 'tool_result', callId: 'call-1', status: 'completed', result: 'ok' })).toEqual([
        { type: 'tool-end', id: 'call-1' },
      ])
    })
  })

  // --- status / lifecycle ---

  describe('status events', () => {
    it('should emit error for a failed turn_end with MISSING_CREDENTIAL shape', () => {
      const parser = new DshParser()
      const events = parser.parseLine({
        type: 'status',
        phase: 'turn_end',
        turn: 1,
        reason: {
          kind: 'error',
          error: {
            message: 'llm-deepseek: no API key for provider route "deepseek-official"',
            code: 'MISSING_CREDENTIAL',
          },
        },
      })
      expect(events).toEqual([
        { type: 'error', message: 'llm-deepseek: no API key for provider route "deepseek-official"' },
      ])
    })

    it('should ignore turn_start/step phases and unobserved success reasons', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ type: 'status', phase: 'turn_start', turn: 1 })).toEqual([])
      expect(parser.parseLine({ type: 'status', phase: 'step_start', turn: 1, step: 1 })).toEqual([])
      expect(parser.parseLine({ type: 'status', phase: 'turn_end', turn: 1, reason: { kind: 'done' } })).toEqual([])
    })

    it('should ignore session and final lifecycle lines', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ type: 'session', sessionId: 'session-1', cwd: 'C:/repo' })).toEqual([])
      expect(parser.parseLine({ type: 'final', text: 'same lossless answer' })).toEqual([])
    })
  })

  // --- unknown types ---

  describe('unknown types', () => {
    it('should return empty array for unknown type', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ type: 'step_usage', usage: {} })).toEqual([])
    })

    it('should return empty array when type is missing', () => {
      const parser = new DshParser()
      expect(parser.parseLine({ foo: 'bar' })).toEqual([])
    })
  })
})
