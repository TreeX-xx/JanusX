// Opt-in, read-only CLI status/discovery through real Windows -> WSL transport.
import { expect, it, vi } from 'vitest'
import type { RemoteCliInstallState, RemoteCliProbe } from '../../src/shared/workspace-runtime'
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), isPackaged: false } }))
import { runtimeCliRequest } from '../../src/main/workspace/runtime'

it.skipIf(process.env.JANUSX_CLI_WSL_LIVE !== '1')('reads complete status responses through real WSL without installing anything', async () => {
  const runtime = { kind: 'wsl' as const, distro: 'NewAPI-WSL', root: '' }
  for (let index = 0; index < 30; index++) {
    const status = await runtimeCliRequest<RemoteCliInstallState>(runtime, { method: 'status', tool: 'opencode' })
    expect(['idle', 'running', 'complete', 'failed']).toContain(status.state)
  }
  const probe = await runtimeCliRequest<RemoteCliProbe>(runtime, { method: 'detect', tool: 'opencode' })
  expect(probe.platform).toBe('linux')
  expect(typeof probe.installed).toBe('boolean')
}, 60_000)
