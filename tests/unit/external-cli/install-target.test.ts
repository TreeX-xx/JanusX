import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'janusx-target-test') } }))
import { DefaultExternalCliService } from '../../../src/main/external-cli/service'

describe('install result is bound to the actual target', () => {
  it.each(['same', 'shadowed', 'wrong-version'] as const)('verifies the receipt and active command: %s', async scenario => {
    const target = { path: join(tmpdir(), 'private-cli', 'pi'), version: '1.2.3' }
    const detect = vi.fn(async () => ({ toolId: 'pi', installed: true, runnable: true,
      path: target.path, version: scenario === 'wrong-version' ? '1.0.0' : target.version }))
    const findCandidate = vi.fn(async () => ({ path: scenario === 'shadowed' ? join(tmpdir(), 'old-cli', 'pi') : target.path, source: 'path' }))
    const installer = { isBusy: () => false, install: async () => ({ success: true, target }) }
    const service = new DefaultExternalCliService({ pi: { detect, findCandidate } } as never, undefined, undefined, undefined, installer as never)
    const result = await service.install('pi')
    expect(detect).toHaveBeenCalledWith({ path: target.path, source: 'path' })
    expect(result.success).toBe(scenario === 'same')
    if (scenario === 'shadowed') expect(result.error).toContain('active command')
    if (scenario === 'wrong-version') expect(result.error).toContain('reports 1.0.0')
  })
})
