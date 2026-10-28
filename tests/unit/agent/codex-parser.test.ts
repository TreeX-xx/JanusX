import { describe, it, expect, beforeEach } from 'vitest'

describe('CodexParser', () => {
  let CodexParser: new () => { parseLine(json: Record<string, unknown>): import('../../../src/main/janus-runner/types').AgentEvent[]; reset(): void }

  beforeEach(async () => {
    const mod = await import('../../../src/main/janus-runner/parsers/codex-parser')
    CodexParser = mod.CodexParser
  })

  // --- text events ---

  describe('text events', () => {
    it('should emit text-chunk for agent_message with text', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'agent_message', text: 'Hello from Codex' })
      expect(events).toEqual([{ type: 'text-chunk', text: 'Hello from Codex' }])
    })

    it('should not emit event when text is missing', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'agent_message' })
      expect(events).toEqual([])
    })
  })

  // --- tool events ---

  describe('tool events', () => {
    it('should emit tool-start for item.started with command', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({
        type: 'item.started',
        item: { id: 'item1', type: 'command', command: 'ls -la' },
      })
      expect(events).toEqual([
        { type: 'tool-start', id: 'item1', name: 'command', arg: 'ls -la' },
      ])
    })

    it.each([
      [{ id: 'item2', type: 'file_read', path: '/src/index.ts' }, '/src/index.ts'],
      [{ id: 'item3', type: 'search', query: 'TODO' }, 'TODO'],
      [{ id: 'item4', type: 'unknown' }, ''],
    ] as const)('should extract arg from %s', async (item, expectedArg) => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'item.started', item })
      expect(events).toEqual([
        { type: 'tool-start', id: item.id, name: item.type, arg: expectedArg },
      ])
    })

    it('should use Date.now fallback when item.id is missing', () => {
      const parser = new CodexParser()
      const before = Date.now()
      const events = parser.parseLine({
        type: 'item.started',
        item: { type: 'command', command: 'ls' },
      })
      const after = Date.now()
      expect(events).toHaveLength(1)
      const event = events[0]
      if (event.type !== 'tool-start') throw new Error(`Expected tool-start, got ${event.type}`)
      const id = Number(event.id)
      expect(id).toBeGreaterThanOrEqual(before)
      expect(id).toBeLessThanOrEqual(after)
    })

    it('should emit tool-end for item.completed', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({
        type: 'item.completed',
        item: { id: 'item1' },
      })
      expect(events).toEqual([{ type: 'tool-end', id: 'item1' }])
    })

    it('should not emit tool-start when item is missing', () => {
      const parser = new CodexParser()
      expect(parser.parseLine({ type: 'item.started' })).toEqual([])
    })

    it('should not emit tool-end when item is missing', () => {
      const parser = new CodexParser()
      expect(parser.parseLine({ type: 'item.completed' })).toEqual([])
    })
  })

  // --- error events ---

  describe('error events', () => {
    it('should emit error event with message field', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'error', message: 'connection failed' })
      expect(events).toEqual([{ type: 'error', message: 'connection failed' }])
    })

    it('should fall back to error field when message is absent', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'error', error: 'timeout' })
      expect(events).toEqual([{ type: 'error', message: 'timeout' }])
    })

    it('should emit error with empty string when both fields are absent', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'error' })
      expect(events).toEqual([{ type: 'error', message: '' }])
    })
  })

  // --- done events ---

  describe('done events', () => {
    it('should emit done event for thread.completed', () => {
      const parser = new CodexParser()
      const events = parser.parseLine({ type: 'thread.completed' })
      expect(events).toEqual([{ type: 'done', exitCode: 0 }])
    })
  })

  // --- unknown types ---

  describe('unknown types', () => {
    it('should return empty array for unknown type', () => {
      const parser = new CodexParser()
      expect(parser.parseLine({ type: 'status_update', status: 'running' })).toEqual([])
    })

    it('should return empty array when type is missing', () => {
      const parser = new CodexParser()
      expect(parser.parseLine({ foo: 'bar' })).toEqual([])
    })
  })
})
