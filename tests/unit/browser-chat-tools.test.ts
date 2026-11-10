import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
const fixture = vi.hoisted(() => ({ enabled: true, mode: 'per-action', call: vi.fn(async () => ({ ok: true })), begin: vi.fn() }))
vi.mock('../../src/main/config/service', () => ({ configService: {
  getControlSettings: async () => ({ browser: { enabled: fixture.enabled } }), getAgentApprovalMode: async () => fixture.mode, get: async () => ({ language: 'en' }),
} }))
vi.mock('../../src/main/browser/control-service', () => ({ browserControl: () => ({
  beginTurn: fixture.begin, call: fixture.call, catalog: async () => [
    { name: 'new_page', description: 'Open page', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
    { name: 'take_snapshot', description: 'Read page', inputSchema: { type: 'object', properties: { pageId: { type: 'integer' } }, required: ['pageId'], additionalProperties: false } },
    { name: 'fill', description: 'Fill field', inputSchema: { type: 'object', properties: { pageId: { type: 'integer' }, uid: { type: 'string' }, value: { type: 'string' } }, required: ['pageId', 'uid', 'value'], additionalProperties: false } },
  ],
}) }))
import { attachBrowserTools } from '../../src/main/browser/chat-tools'
describe('browser chat approval and discovery', () => {
  beforeEach(() => { fixture.enabled = true; fixture.mode = 'per-action'; fixture.call.mockClear(); fixture.begin.mockClear() })
  async function setup(answer?: 'Allow' | 'Deny', mode?: 'plan' | 'auto-run') {
    const askUser = vi.fn(async () => ({ status: 'answered', answers: [{ header: 'Browser', selected: [answer] }] }))
    const ports = { localTools: [], ...(answer ? { question: { askUser } } : {}) } as unknown as ChatTurnPorts
    await attachBrowserTools(ports, { owner: 'one', runId: 'turn', signal: new AbortController().signal, ...(mode ? { getApprovalMode: async () => mode } : {}) })
    const call = (name: string, args: unknown) => ports.localTools!.find(tool => tool.name === name)!.execute({ id: 'call', name, arguments: args }, new AbortController().signal)
    return { ports, call, askUser }
  }
  it('offers no browser tools when disabled', async () => { fixture.enabled = false; expect((await setup()).ports.localTools).toEqual([]) })
  it('fails closed when an action has no approval UI or is declined', async () => {
    expect((await (await setup()).call('browser_new_page', { url: 'https://example.test' })).isError).toBe(true)
    expect((await (await setup('Deny')).call('browser_new_page', { url: 'https://example.test' })).isError).toBe(true)
    expect(fixture.call).not.toHaveBeenCalled()
  })
  it('allows inspection without a mutation prompt and forwards approved actions', async () => {
    const f = await setup('Allow')
    expect((await f.call('browser_take_snapshot', { pageId: 7 })).isError).not.toBe(true)
    expect(f.askUser).not.toHaveBeenCalled()
    await f.call('browser_new_page', { url: 'https://example.test' })
    expect(f.askUser).toHaveBeenCalledOnce()
    expect(fixture.call).toHaveBeenCalledTimes(2)
  })
  it('honors the stricter session plan mode and explicit auto-run', async () => {
    fixture.mode = 'auto-run'
    expect((await (await setup('Allow', 'plan')).call('browser_new_page', { url: 'https://example.test' })).isError).toBe(true)
    expect(fixture.call).not.toHaveBeenCalled()
    expect((await (await setup(undefined, 'auto-run')).call('browser_new_page', { url: 'https://example.test' })).isError).not.toBe(true)
  })
  it('does not display typed field values in the approval question', async () => {
    const f = await setup('Allow')
    await f.call('browser_fill', { pageId: 7, uid: '1_1', value: 'secret-value' })
    expect(JSON.stringify(f.askUser.mock.calls)).not.toContain('secret-value')
  })
})
