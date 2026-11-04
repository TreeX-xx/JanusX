import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeConversation, type NativeEvent } from '../../src/main/terminal/native-conversation'
import { PiConversation } from '../../src/main/terminal/extension-conversation'
import { supportsConversation } from '../../src/shared/conversation-display'

class Fixture extends NativeConversation {
  deliver = vi.fn(async () => {})
  constructor() { super('fixture', 'pi', () => {}) }
  emit(event: NativeEvent) { this.receive(event) }
  async start() { return { command: 'pi', args: [] } }
  async dispose() { this.close() }
}
describe('native conversation controls', () => {
  it('waits for native resolution and preserves unrelated terminal attention after a late confirmation', async () => {
    vi.useFakeTimers()
    const c = new Fixture()
    try {
      c.emit({ type: 'session', sessionId: 's' })
      await c.command({ type: 'mode', mode: 'conversation' })
      c.emit({ type: 'question', request: { id: 'q', questions: [{ id: 'choice', text: 'Choose', options: [{ id: 'yes', label: 'Yes' }] }] } })
      await c.command({ type: 'answer', requestId: 'q', version: c.state.questions![0].version, controlEpoch: c.state.controlEpoch,
        answer: { answers: [{ id: 'choice', selected: ['yes'] }] } })
      expect(c.state.questions![0].status).toBe('submitting')
      await vi.advanceTimersByTimeAsync(15000)
      c.emit({ type: 'attention', pending: false })
      expect(c.state.needsTerminal).toBe(true)
      c.emit({ type: 'attention', pending: true })
      c.emit({ type: 'question-resolved', requestId: 'q' })
      expect(c.state.questions).toEqual([])
      expect(c.state.error).toBeUndefined()
      expect(c.state.needsTerminal).toBe(true)
      c.emit({ type: 'attention', pending: false })
      expect(c.state.needsTerminal).toBe(false)
    } finally { await c.dispose(); vi.useRealTimers() }
  })

  it('keeps active-turn submission blocked for adapters without liveInput', async () => {
    const c = new Fixture()
    try {
      c.emit({ type: 'session', sessionId: 'session' })
      await c.command({ type: 'mode', mode: 'conversation' })
      c.emit({ type: 'start', turnId: 'active' })
      await expect(c.command({ type: 'send', commandId: 'blocked', text: 'text', controlEpoch: c.state.controlEpoch })).rejects.toThrow('busy')
      expect(c.deliver).not.toHaveBeenCalled()
    } finally { await c.dispose() }
  })
  it('enables the five supported engines and rejects unrelated terminals', () => {
    for (const engine of ['codex', 'claude', 'pi', 'dsh', 'opencode']) expect(supportsConversation(engine)).toBe(true)
    for (const engine of ['shell', 'janus', '']) expect(supportsConversation(engine)).toBe(false)
  })
  it('fences stale control, deduplicates sends and revokes control after a session switch', async () => {
    const c = new Fixture()
    try {
      c.emit({ type: 'session', sessionId: 'one' })
      const send = (text: string, epoch = c.state.controlEpoch) => c.command({ type: 'send', commandId: 'same', text, controlEpoch: epoch })
      await expect(send('hello')).rejects.toThrow('Stale')
      await c.command({ type: 'mode', mode: 'conversation' })
      expect(c.acceptsTerminalInput('text')).toBe(false)
      expect(c.acceptsTerminalInput('\x1b[1;1R')).toBe(true)
      await expect(send('hello', 0)).rejects.toThrow('Stale')
      await send('hello'); await send('hello')
      expect(c.deliver).toHaveBeenCalledTimes(1)
      await expect(send('different')).rejects.toThrow('reused')
      c.emit({ type: 'session', sessionId: 'two' })
      expect(c.state.connection).toBe('disconnected')
      expect(c.state.threadId).toBe('one')
      await expect(send('hello')).rejects.toThrow('unavailable')
      await c.command({ type: 'mode', mode: 'terminal' })
      expect(c.acceptsTerminalInput('text')).toBe(true)
    } finally { await c.dispose() }
  })
  it('preserves interrupted work and bounds text and history without fabricating plans', async () => {
    const c = new Fixture()
    try {
      c.emit({ type: 'session', sessionId: 'one' }); c.emit({ type: 'start', turnId: 'turn' })
      for (let i = 0; i < 501; i++) c.emit({ type: 'item', item: { id: String(i), turnId: 'turn', type: 'agentMessage', text: 'x'.repeat(33000), status: 'inProgress' } })
      c.emit({ type: 'end', outcome: 'interrupted' })
      expect(c.state.items).toHaveLength(500)
      expect(c.state.items.at(-1)).toMatchObject({ status: 'interrupted', truncated: true, durationMs: expect.any(Number) })
      expect(c.state.items[0].text).toHaveLength(32000)
      expect(c.state.turnId).toBeNull(); expect(c.state.plans).toBeUndefined()
      c.emit({ type: 'start', turnId: 'failed' }); c.emit({ type: 'end', outcome: 'failed', error: 'Provider unavailable' })
      expect(c.state.items.at(-1)).toMatchObject({ text: 'Provider unavailable', status: 'failed' })
    } finally { await c.dispose() }
  })
  it('authenticates the extension bridge, deduplicates events and fails closed on a sequence gap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-bridge-test-'))
    const pkg = join(root, 'node_modules/@earendil-works/pi-coding-agent')
    await mkdir(pkg, { recursive: true }); await writeFile(join(pkg, 'package.json'), '{"version":"0.85.1"}')
    const c = new PiConversation('bridge', () => {})
    try {
      await c.start({ command: join(root, 'pi.cmd'), args: [], cwd: root, env: {}, assetsDir: join(root, 'assets') })
      const dir = join(root, 'assets', (await readdir(join(root, 'assets')))[0])
      const connection = await readFile(join(dir, 'connection.mjs'), 'utf8')
      const endpoint = JSON.parse(/endpoint=("[^"]+")/.exec(connection)![1])
      const token = JSON.parse(/token=("[^"]+")/.exec(connection)![1])
      const post = (body: unknown, auth = token, origin?: string) => fetch(`${endpoint}/exchange`, { method: 'POST', headers: { 'X-JanusX-Token': auth, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) })
      const body = { sessionId: 'real', instanceId: 'runtime', events: [{ seq: 1, event: { type: 'session', sessionId: 'real' } }] }
      expect((await post(body, 'invalid')).status).toBe(403)
      expect((await post(body, token, 'https://example.com')).status).toBe(403)
      expect((await post(body)).status).toBe(200)
      const revision = c.state.revision
      await post(body); expect(c.state.revision).toBe(revision)
      expect((await post({ sessionId: 'real', instanceId: 'runtime', events: [{ seq: 3, event: { type: 'start' } }] })).status).toBe(409)
      expect(c.state.connection).toBe('disconnected')
    } finally { await c.dispose(); await rm(root, { recursive: true, force: true }) }
  })
})
