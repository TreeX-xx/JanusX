import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn(), prepare: vi.fn() }))
vi.mock('../../src/main/workspace/runtime', () => ({ readWorkspaceRecord: mocks.read, runtimeCliRequest: mocks.request, prepareRuntimeBackend: mocks.prepare }))
import { detectRemoteCli, installRemoteCli } from '../../src/main/workspace/remote-cli'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue({ runtime: { kind: 'wsl', distro: 'Ubuntu', root: '/project' } })
})
it('detects in the registered target, rejecting local or unsupported tools', async () => {
  mocks.request.mockResolvedValue({ installed: true })
  expect(await detectRemoteCli('ws', 'codex')).toEqual({ installed: true })
  expect(mocks.request).toHaveBeenCalledWith({ kind: 'wsl', distro: 'Ubuntu', root: '/project' }, { method: 'detect', tool: 'codex' })
  await expect(detectRemoteCli('ws', 'other')).rejects.toThrow('Unsupported')
  mocks.read.mockResolvedValue({ runtime: { kind: 'windows' } })
  await expect(detectRemoteCli('ws', 'codex')).rejects.toThrow('WSL or SSH')
})
it('reattaches to a durable installation without submitting another install', async () => {
  mocks.request.mockResolvedValue({ state: 'running' })
  expect(await installRemoteCli('ws', 'codex')).toEqual({ state: 'running' })
  expect(mocks.request).toHaveBeenCalledTimes(1)
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it('prepares user-level Linux Node and installs the declared package when dependencies are missing', async () => {
  mocks.request.mockResolvedValueOnce({ state: 'idle' }).mockResolvedValueOnce({ installed: false, platform: 'linux', architecture: 'x86_64', libc: ['glibc', '2.39'] }).mockResolvedValueOnce({ state: 'running' })
  await installRemoteCli('ws', 'codex')
  expect(mocks.prepare).toHaveBeenCalledOnce()
  expect(mocks.request.mock.calls[2][1]).toEqual({ method: 'install', tool: 'codex', packages: ['@openai/codex'] })
})
it('does not attempt incompatible Node downloads or install on unsupported architectures', async () => {
  mocks.request.mockResolvedValueOnce({ state: 'idle' }).mockResolvedValueOnce({ installed: false, platform: 'linux', architecture: 'aarch64', libc: ['musl', '1.2'] })
  await expect(installRemoteCli('ws', 'codex')).rejects.toThrow('compatible Node.js')
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.request).toHaveBeenCalledTimes(2)
})
