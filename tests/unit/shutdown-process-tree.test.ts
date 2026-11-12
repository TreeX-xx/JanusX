import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ capture: vi.fn(), stop: vi.fn() }))
vi.mock('@janus-agent/janus-agent/superagent/native/windows-process-tree', () => ({
  captureAndStopWindowsProcessTree: native.capture, terminateWindowsProcessTree: native.stop,
}))
vi.mock('../../src/main/shutdown/diagnostics', () => ({ logShutdown: vi.fn() }))
import { stopProcessTree, retryPendingProcessStops } from '../../src/main/shutdown/process-tree'

describe.skipIf(process.platform !== 'win32')('owned Windows process shutdown', () => {
  beforeEach(() => { native.capture.mockReset(); native.stop.mockReset().mockResolvedValue(undefined) })
  it('captures before stopping and waits for native exit confirmation without killing the parent first', async () => {
    const target = { pid: 123, kill: vi.fn(), exitCode: null }, tree = [{ pid: 123, started: '1' }]
    let confirm!: () => void
    native.capture.mockImplementation(() => new Promise(resolve => { confirm = () => resolve({ tree, active: [], failures: [] }) }))
    const flight = stopProcessTree(target)
    expect(stopProcessTree(target)).toBe(flight)
    await Promise.resolve(); await Promise.resolve()
    expect(native.capture).toHaveBeenCalledWith(target.pid); expect(target.kill).not.toHaveBeenCalled()
    let done = false; void flight.then(() => { done = true }); await Promise.resolve(); expect(done).toBe(false)
    confirm(); await flight
  })
  it('retains captured identities after failure and retries without recapturing a reused root PID', async () => {
    const tree = [{ pid: 456, started: '1' }]
    native.capture.mockResolvedValue({ tree, active: [456], failures: ['denied'] })
    await expect(stopProcessTree({ pid: 456, exitCode: null })).rejects.toThrow('denied')
    await retryPendingProcessStops()
    expect(native.capture).toHaveBeenCalledOnce(); expect(native.stop).toHaveBeenCalledOnce()
    expect(native.stop).toHaveBeenLastCalledWith(tree)
  })
})
