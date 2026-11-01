import { describe, expect, it, vi } from 'vitest'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'

async function setup() {
  const controller = new OpenCodeConversation('test', vi.fn())
  const wire = controller as any
  let model = { providerID: 'one', id: 'shared', variant: 'default' }
  wire.directory = 'C:/project with spaces'
  wire.receive({ type: 'session', sessionId: 'session' })
  const api = vi.fn(async (path: string, body?: any) => {
    if (path.startsWith('/api/model/default')) return { data: { providerID: 'one', id: 'shared' } }
    if (path.startsWith('/api/model?')) return { data: [
      { providerID: 'one', id: 'shared', name: 'Same name', enabled: true, variants: [{ id: 'careful' }, { id: 'low' }], settings: { apiKey: 'never-publish' } },
      { providerID: 'two', id: 'shared', name: 'Same name', enabled: true, variants: [] },
      { providerID: 'one', id: 'disabled', enabled: false, variants: [] },
      { providerID: 'unavailable', id: 'hidden', enabled: true, variants: [] },
    ] }
    if (path.startsWith('/api/provider?')) return { data: [{ id: 'one', activation: 'enabled' }, { id: 'two', activation: 'auto' }, { id: 'unavailable', activation: 'disabled' }] }
    if (path.endsWith('/model')) { model = { ...body.model, variant: body.model.variant ?? 'default' }; return {} }
    if (path === '/api/session/session') return { data: { id: 'session', model } }
    throw new Error(`Unexpected endpoint: ${path}`)
  })
  wire.api = api
  await controller.command({ type: 'mode', mode: 'conversation' })
  await controller.command({ type: 'models', controlEpoch: controller.state.controlEpoch })
  const settings = (selected = 'one/shared', effort: string | null = 'careful') => controller.command({
    type: 'settings', model: selected, effort, controlEpoch: controller.state.controlEpoch,
  })
  return { controller, wire, api, settings }
}

describe('OpenCode session settings', () => {
  it('lists project models by provider identity and publishes only display metadata', async () => {
    const { controller, api } = await setup()
    try {
      expect(controller.state.models.map(m => m.model)).toEqual(['one/shared', 'two/shared'])
      expect(controller.state.models[0].efforts.map(v => v.effort)).toEqual(['default', 'careful', 'low'])
      expect(controller.state.models[1].efforts.map(v => v.effort)).toEqual(['default'])
      expect(controller.state).toMatchObject({ model: 'one/shared', effort: 'default', capabilities: { settings: true } })
      expect(JSON.stringify(controller.snapshot())).not.toContain('never-publish')
      expect(api).toHaveBeenCalledWith('/api/model?location[directory]=C%3A%2Fproject%20with%20spaces')
    } finally { await controller.dispose() }
  })

  it('confirms native settings and clears the variant when changing to the provider default', async () => {
    const { controller, api, settings } = await setup()
    try {
      await settings()
      expect(api).toHaveBeenCalledWith('/api/session/session/model', { model: { providerID: 'one', id: 'shared', variant: 'careful' } })
      expect(controller.state).toMatchObject({ model: 'one/shared', effort: 'careful', threadId: 'session' })
      await settings('two/shared', null)
      expect(api).toHaveBeenLastCalledWith('/api/session/session')
      expect(api).toHaveBeenCalledWith('/api/session/session/model', { model: { providerID: 'two', id: 'shared' } })
      expect(controller.state).toMatchObject({ model: 'two/shared', effort: 'default' })
    } finally { await controller.dispose() }
  })

  it('rejects stale, unsupported, busy and overlapping changes before sending a mutation', async () => {
    const { controller, api, settings } = await setup()
    try {
      await expect(settings('missing')).rejects.toThrow('Unsupported')
      await expect(settings('two/shared', 'high')).rejects.toThrow('Unsupported')
      await expect(controller.command({ type: 'models', controlEpoch: -1 })).rejects.toThrow('Stale')
      controller.state.turnId = 'running'
      await expect(settings()).rejects.toThrow('idle')
      controller.state.turnId = null
      let release!: () => void
      api.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}) }))
      const updating = settings()
      expect(controller.state.settingsUpdating).toBe(true)
      await expect(settings()).rejects.toThrow('finish')
      await expect(controller.command({ type: 'mode', mode: 'terminal' })).rejects.toThrow('finish')
      await expect(controller.command({ type: 'send', commandId: 'send', text: 'hello', controlEpoch: controller.state.controlEpoch })).rejects.toThrow('finish')
      expect(controller.acceptsTerminalInput('text')).toBe(false)
      expect(controller.acceptsTerminalInput('\x1b[1;1R')).toBe(true)
      release()
      await expect(updating).rejects.toThrow('different settings')
      expect(controller.state.settingsUpdating).toBe(false)
    } finally { await controller.dispose() }
  })

  it('reads back a failed mutation once and preserves the confirmed selection without resending', async () => {
    const { controller, api, settings } = await setup()
    try {
      api.mockRejectedValueOnce(new Error('Request failed'))
      await expect(settings()).rejects.toThrow('Request failed')
      expect(controller.state).toMatchObject({ model: 'one/shared', effort: 'default', connection: 'ready', settingsUpdating: false })
      expect(api.mock.calls.filter(([path]) => path.endsWith('/model'))).toHaveLength(1)
      api.mockRejectedValueOnce(new Error('Timeout')).mockRejectedValueOnce(new Error('Readback failed'))
      await expect(settings()).rejects.toThrow('Timeout')
      expect(controller.state.connection).toBe('disconnected')
      expect(controller.state.error).toContain('outcome is unknown')
    } finally { await controller.dispose() }
  })

  it('allows retrying a catalog failure without disconnecting the session', async () => {
    const { controller, api } = await setup()
    try {
      api.mockRejectedValueOnce(new Error('Catalog unavailable'))
      await controller.command({ type: 'models', controlEpoch: controller.state.controlEpoch })
      expect(controller.state.modelsError).toContain('Catalog unavailable')
      expect(controller.state.connection).toBe('ready')
      await controller.command({ type: 'models', controlEpoch: controller.state.controlEpoch })
      expect(controller.state.modelsError).toBeUndefined()
    } finally { await controller.dispose() }
  })

  it('does not let an earlier polling response overwrite newly confirmed settings', async () => {
    const { controller, wire, api, settings } = await setup()
    const implementation = api.getMockImplementation()!
    api.mockImplementation((path, body) => /\/(message|permission|form)(?:\?|$)/.test(path)
      ? Promise.resolve({ data: [] }) : implementation(path, body))
    let release!: () => void
    api.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ data: { id: 'session', model: { providerID: 'one', id: 'shared', variant: 'default' } } })
    }))
    const polling = wire.poll()
    try {
      await settings()
      release()
      await vi.waitFor(() => expect(api.mock.calls.some(([path]) => path.includes('/message?'))).toBe(true))
      expect(controller.state).toMatchObject({ model: 'one/shared', effort: 'careful' })
    } finally { await controller.dispose(); await polling }
  })
})
