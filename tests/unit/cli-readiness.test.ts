import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { closeLocalCliSetup, ensureLocalCli, prepareLocalCli, probeCli, useCliReadiness, useLocalCliSetup } from '../../src/renderer/src/stores/cli-readiness'

beforeEach(() => { closeLocalCliSetup(); useCliReadiness.setState({ probes: {} }) })
afterEach(() => { closeLocalCliSetup(); vi.unstubAllGlobals() })

it('forced post-install detection waits for an older probe and then actually checks again', async () => {
  let release!: (value: unknown) => void
  const detect = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockResolvedValue({ toolId: 'codex', installed: true, runnable: true })
  vi.stubGlobal('window', { electron: { externalCli: { detect } } })
  const previous = probeCli('codex')
  const refreshed = probeCli('codex', undefined, true)
  release({ toolId: 'codex', installed: false, runnable: false })
  await expect(previous).resolves.toMatchObject({ runnable: false })
  await expect(refreshed).resolves.toMatchObject({ runnable: true })
  expect(detect).toHaveBeenCalledTimes(2)
})

it('closing setup abandons the launch even when installation completes later', async () => {
  let installed = false
  let release!: () => void
  const install = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); installed = true; return { success: true } })
  vi.stubGlobal('window', { electron: { externalCli: {
    detect: async () => ({ toolId: 'codex', installed, runnable: installed }), install,
  } } })
  const launch = ensureLocalCli('codex')
  await vi.waitFor(() => expect(useLocalCliSetup.getState().request?.checking).toBe(false))
  const preparing = prepareLocalCli(true)
  closeLocalCliSetup()
  await expect(launch).resolves.toBe(false)
  release()
  await preparing
  expect(useLocalCliSetup.getState().request).toBeNull()
  expect(useCliReadiness.getState().probes['local:codex'].runnable).toBe(true)
})
