import { describe, expect, it, vi } from 'vitest'
import { CodexStartup, codexTrustTarget } from '../../src/main/terminal/codex-startup'

function fixture(kind: 'login' | 'trust' = 'trust') {
  const call = vi.fn<(method: string, params: Record<string, any>) => Promise<Record<string, any>>>()
  const publish = vi.fn()
  const forward = vi.fn()
  const startup = new CodexStartup(call, publish)
  const id = kind === 'trust' ? 'tui-project-trust-read-native' : 1
  startup.observeRequest({ id, method: kind === 'trust' ? 'config/read' : 'account/read', params: kind === 'trust' ? { cwd: 'C:\\workspace', includeLayers: true } : {} })
  expect(startup.intercept({ id, result: kind === 'trust' ? { config: {}, layers: [] } : { requiresOpenaiAuth: true, account: null } }, forward)).toBe(true)
  const command = { type: 'startup' as const, startupId: startup.state!.id, controlEpoch: 1 }
  return { startup, call, publish, forward, command }
}

describe('structured Codex startup confirmation', () => {
  it('trusts only the reviewed hook hashes and waits for native readback', async () => {
    const hook = { key: 'hook-1', eventName: 'SessionStart', sourcePath: '/project/hooks.json', handlerType: 'command', command: 'reviewed-command', currentHash: 'reviewed-hash', trustStatus: 'modified' }
    const call = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [{ hooks: [{ ...hook, trustStatus: 'trusted' }] }] })
    const forward = vi.fn()
    const startup = new CodexStartup(call, vi.fn())
    startup.observeRequest({ id: 'hooks-list-native', method: 'hooks/list', params: { cwds: ['/project'] } })
    expect(startup.intercept({ id: 'hooks-list-native', result: { data: [{ hooks: [hook] }] } }, forward)).toBe(true)
    expect(startup.state).toMatchObject({ kind: 'hooks', hooks: [{ event: 'SessionStart', command: 'reviewed-command' }] })
    await startup.command({ type: 'startup', startupId: startup.state!.id, action: 'trust', controlEpoch: 1 })
    expect(call.mock.calls[0]).toEqual(['config/batchWrite', { edits: [{ keyPath: 'hooks.state', value: { 'hook-1': { trusted_hash: 'reviewed-hash' } }, mergeStrategy: 'upsert' }], reloadUserConfig: true }])
    expect(forward).toHaveBeenCalledOnce()
  })

  it('handles login completion arriving before the start response', async () => {
    const { startup, call, forward, command } = fixture('login')
    let resolve!: (value: object) => void
    call.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValueOnce({ requiresOpenaiAuth: true, account: { type: 'chatgpt' } })
    const pending = startup.command({ ...command, action: 'login' })
    await startup.receive({ method: 'account/login/completed', params: { loginId: 'early', success: true } })
    resolve({ loginId: 'early', authUrl: 'https://auth.openai.com/authorize' })
    await pending
    expect(forward).toHaveBeenCalledOnce()
    expect(startup.state).toBeUndefined()
  })
  it('keeps native startup paused until explicit trust is persisted and read back', async () => {
    const { startup, call, forward, command } = fixture()
    expect(call).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
    await startup.command({ ...command, action: 'cancel' })
    expect(startup.state?.status).toBe('cancelled')
    await expect(startup.command({ ...command, action: 'trust' })).rejects.toThrow('Resume')
    await startup.command({ ...command, action: 'resume' })
    call.mockResolvedValueOnce({}).mockResolvedValueOnce({ config: { projects: { 'C:\\workspace': { trust_level: 'trusted' } } } })
    await startup.command({ ...command, action: 'trust' })
    expect(call.mock.calls[0]).toEqual(['config/batchWrite', { edits: [{ keyPath: 'projects."C:\\\\workspace".trust_level', value: 'trusted', mergeStrategy: 'replace' }], reloadUserConfig: true }])
    expect(forward).toHaveBeenCalledOnce()
    expect(forward.mock.calls[0][0].id).toBe('tui-project-trust-read-native')
    expect(startup.state).toBeUndefined()
    await expect(startup.command({ ...command, action: 'trust' })).rejects.toThrow('no longer pending')
  })

  it('rejects stale, wrong-kind and concurrent approvals; preserves failed confirmation for retry', async () => {
    const { startup, call, forward, command } = fixture()
    await expect(startup.command({ ...command, startupId: 999, action: 'trust' })).rejects.toThrow('no longer pending')
    await expect(startup.command({ ...command, action: 'login' })).rejects.toThrow('Invalid')
    let reject!: (error: Error) => void
    call.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const pending = startup.command({ ...command, action: 'trust' })
    await expect(startup.command({ ...command, action: 'trust' })).rejects.toThrow('busy')
    reject(new Error('Config is read-only'))
    await pending
    expect(startup.state).toMatchObject({ status: 'pending', error: expect.stringContaining('read-only') })
    expect(forward).not.toHaveBeenCalled()
  })

  it('resumes browser login only after matching completion and account readback', async () => {
    const { startup, call, forward, command } = fixture('login')
    call.mockResolvedValueOnce({ loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize?state=example' })
    await startup.command({ ...command, action: 'login' })
    expect(startup.state).toMatchObject({ status: 'waiting', authUrl: expect.stringContaining('https://auth.openai.com/') })
    await startup.receive({ method: 'account/login/completed', params: { loginId: 'other', success: true } })
    expect(forward).not.toHaveBeenCalled()
    call.mockResolvedValueOnce({ requiresOpenaiAuth: true, account: { type: 'chatgpt', email: 'private@example.test' } })
    await startup.receive({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } })
    expect(forward).toHaveBeenCalledOnce()
    expect(startup.state).toBeUndefined()
  })

  it('cancels the actual login and ignores late success after cancellation', async () => {
    const { startup, call, forward, command } = fixture('login')
    call.mockResolvedValueOnce({ loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize' }).mockResolvedValue({})
    await startup.command({ ...command, action: 'login' })
    await startup.command({ ...command, action: 'cancel' })
    expect(call).toHaveBeenLastCalledWith('account/login/cancel', { loginId: 'login-1' })
    await startup.receive({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } })
    expect(forward).not.toHaveBeenCalled()
    expect(startup.state).toMatchObject({ status: 'cancelled', authUrl: undefined })
  })

  it('never publishes a key or an upstream error containing the key', async () => {
    const { startup, call, publish, command } = fixture('login')
    call.mockRejectedValueOnce(new Error('Invalid secret-test-key'))
    await startup.command({ ...command, action: 'apiKey', apiKey: 'secret-test-key' })
    expect(JSON.stringify(publish.mock.calls)).not.toContain('secret-test-key')
    expect(startup.state?.status).toBe('pending')
    call.mockResolvedValueOnce({ type: 'apiKey' }).mockResolvedValueOnce({ requiresOpenaiAuth: true, account: { type: 'apiKey' } })
    await startup.command({ ...command, action: 'apiKey', apiKey: 'secret-test-key' })
    expect(startup.state).toBeUndefined()
  })

  it('does not forward a confirmation after session disposal', async () => {
    const { startup, call, forward, command } = fixture()
    let resolve!: (value: object) => void
    call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = startup.command({ ...command, action: 'trust' })
    startup.dispose(); resolve({}); await pending
    expect(forward).not.toHaveBeenCalled()
  })

  it('uses Codex trust targets and preserves saved restricted choices and trusted project layers', () => {
    expect(codexTrustTarget({ config: { projects: { 'c:\\workspace': { trust_level: 'trusted' } } } }, 'C:\\workspace')).toBeUndefined()
    expect(codexTrustTarget({ config: { projects: { '/workspace': { trust_level: 'untrusted' } } } }, '/workspace')).toBeUndefined()
    expect(codexTrustTarget({ config: {}, layers: [{ name: { type: 'project', dotCodexFolder: '/repo/.codex' }, disabledReason: '/repo is not trusted, add /repo as a trusted project in config.toml' }] }, '/repo/child')).toBe('/repo')
    expect(codexTrustTarget({ config: {}, layers: [{ name: { type: 'project' } }] }, '/repo')).toBeUndefined()
  })

  it('passes already authenticated and custom-provider reads without a prompt', () => {
    const startup = new CodexStartup(vi.fn(), vi.fn())
    for (const result of [{ requiresOpenaiAuth: false, account: null }, { requiresOpenaiAuth: true, account: { type: 'apiKey' } }]) {
      startup.observeRequest({ id: 1, method: 'account/read', params: {} })
      expect(startup.intercept({ id: 1, result }, vi.fn())).toBe(false)
    }
    expect(startup.state).toBeUndefined()
  })
})
