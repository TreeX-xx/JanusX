import { expect, it, vi } from 'vitest'
import { nativeModelsHost } from '../../src/main/plugins/native-models'
import type { InstalledPlugin } from '../../src/shared/ipc/plugins'

vi.mock('../../src/main/llm/LlmService', () => ({ llmService: {} }))
vi.mock('../../src/main/llm/ai-runtime', () => ({ generateText: vi.fn() }))

function fixture(allowed = true) {
  let key = ''
  const read = vi.fn(async () => key)
  const status = vi.fn(async () => !!key)
  const set = vi.fn(async (_slot: string, _origin: string, value: string) => { key = value })
  const record = { manifest: { permissions: [{ name: 'models.generate' }, ...(allowed ? [{ name: 'credentials.use' }] : [])],
    contributes: { credentials: [{ id: 'jev', origin: 'https://api.typesafe.ai', title: 'JEV' }] } } } as InstalledPlugin
  return { host: nativeModelsHost(record, { read, status, set }), read, set }
}
const signal = () => new AbortController().signal
it('edits only a declared credential and returns status without ever reading the secret', async () => {
  const f = fixture()
  expect(await f.host('models.credential-status', { slot: 'jev' }, signal())).toEqual({ configured: false })
  expect(await f.host('models.credential-set', { slot: 'jev', value: 'fixture-key' }, signal())).toEqual({ configured: true })
  expect(f.set).toHaveBeenCalledWith('jev', 'https://api.typesafe.ai', 'fixture-key')
  expect(await f.host('models.credential-set', { slot: 'jev', value: '' }, signal())).toEqual({ configured: false })
  expect(f.read).not.toHaveBeenCalled()
})
it('rejects missing permission, undeclared slots and caller-supplied origins', async () => {
  const f = fixture(), denied = fixture(false)
  await expect(denied.host('models.credential-set', { slot: 'jev', value: 'fixture-key' }, signal())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  await expect(f.host('models.credential-set', { slot: 'other', value: 'fixture-key' }, signal())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  await expect(f.host('models.credential-set', { slot: 'jev', origin: 'https://other.test', value: 'fixture-key' }, signal())).rejects.toThrow()
  expect(f.set).not.toHaveBeenCalled(); expect(denied.set).not.toHaveBeenCalled()
})
it('rejects cancellation and malformed credentials before writing', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort()
  await expect(f.host('models.credential-set', { slot: 'jev', value: 'fixture-key' }, controller.signal)).rejects.toThrow()
  await expect(f.host('models.credential-set', { slot: 'jev', value: 'has a space' }, signal())).rejects.toThrow()
  await expect(f.host('models.credential-set', { slot: 'jev', value: 'x'.repeat(4097) }, signal())).rejects.toThrow()
  expect(f.set).not.toHaveBeenCalled()
})
