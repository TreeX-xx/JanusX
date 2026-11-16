import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { EXTERNAL_CLI_TOOLS } from '../../../src/main/external-cli/tool-registry'
import type { ExternalCliDetectResult } from '../../../src/shared/ipc/external-cli'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => join(tmpdir(), 'janusx-test-user-data')) },
}))

const { DefaultExternalCliService } = await import('../../../src/main/external-cli/service')

function createHarness(probe: ExternalCliDetectResult) {
  const calls: string[] = []
  const healthy = { toolId: 'codex', installed: true, runnable: true, version: '9.9.9' } as const
  // System repairs reinstall in place; never pre-uninstall another source.
  let current: ExternalCliDetectResult = probe
  const detector = { detect: vi.fn(async () => current) }
  const installer = {
    isBusy: vi.fn(() => false),
    install: vi.fn(async () => {
      calls.push('install')
      current = healthy
      return { success: true, command: 'npm i -g @openai/codex@latest' }
    }),
    uninstall: vi.fn(async () => {
      calls.push('uninstall')
      return { success: true, command: 'npm rm -g @openai/codex' }
    }),
  }
  const service = new DefaultExternalCliService(
    { codex: detector } as never,
    undefined,
    undefined,
    undefined,
    installer as never,
  )
  return { service, detector, installer, calls }
}

describe('codex in-place repair', () => {
  it('reinstalls without removing a system installation', async () => {
    const { service, calls } = createHarness({
      toolId: 'codex',
      installed: true,
      runnable: false,
      hint: 'exited with code 1',
    })

    const result = await service.install('codex')
    expect(calls).toEqual(['install'])
    expect(result).toMatchObject({ success: true })
  })

  it('does not call the old uninstall path even if it would fail', async () => {
    const { service, installer, calls } = createHarness({
      toolId: 'codex',
      installed: true,
      runnable: false,
      hint: 'exited with code 1',
    })
    installer.uninstall.mockImplementationOnce(async () => {
      calls.push('uninstall')
      return { success: false, error: 'npm ERR! locked' }
    })

    const result = await service.install('codex')
    expect(calls).toEqual(['install'])
    expect(result).toMatchObject({ success: true })
  })

  it('skips removal for healthy and missing installs', async () => {
    const healthy = createHarness({ toolId: 'codex', installed: true, runnable: true, version: '1.0.0' })
    await healthy.service.install('codex')
    expect(healthy.calls).toEqual(['install'])

    const missing = createHarness({ toolId: 'codex', installed: false, runnable: false, hint: 'npm i -g @openai/codex@latest' })
    await missing.service.install('codex')
    expect(missing.calls).toEqual(['install'])
  })

  it('leaves other tools on the plain install path', async () => {
    const calls: string[] = []
    const installer = {
      isBusy: vi.fn(() => false),
      install: vi.fn(async () => {
        calls.push('install')
        return { success: true, command: 'npm i -g @anthropic-ai/claude-code@latest' }
      }),
      uninstall: vi.fn(async () => {
        calls.push('uninstall')
        return { success: true }
      }),
    }
    const service = new DefaultExternalCliService(
      {
        codex: { detect: vi.fn(async () => ({ toolId: 'codex', installed: true, runnable: false })) },
        claude: { detect: vi.fn(async () => ({ toolId: 'claude', installed: true, runnable: true, version: '2.0.0' })) },
      } as never,
      undefined,
      undefined,
      undefined,
      installer as never,
    )
    const result = await service.install('claude')
    // No removal runs for claude; the plain install plus healthy re-probe decides.
    expect(calls).toEqual(['install'])
    expect(result).toMatchObject({ success: true })
    expect(EXTERNAL_CLI_TOOLS.codex.npmPackage).toBe('@openai/codex')
  })
})
