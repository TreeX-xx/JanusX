import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { normalizeControlSettings } from '../../src/shared/ipc/control'

let directory = '.'
vi.mock('electron', () => ({ app: { getPath: () => directory } }))
describe('control configuration', () => {
  it('migrates absent settings and bounds numeric values', () => {
    expect(normalizeControlSettings(undefined)).toEqual({ browser: { enabled: true, timeoutMs: 15000 }, computer: { executable: '' } })
    expect(normalizeControlSettings({ browser: { enabled: false, timeoutMs: -20 }, computer: { executable: ' driver ' } })).toEqual({ browser: { enabled: false, timeoutMs: 3000 }, computer: { executable: 'driver' } })
  })
  it('atomically saves independent panels without re-enabling a disabled browser', async () => {
    directory = await mkdtemp(join(tmpdir(), 'janusx-control-config-'))
    const { ConfigService } = await import('../../src/main/config/service')
    const service = new ConfigService()
    await Promise.all([
      service.updateControlSettings({ browser: { enabled: false, timeoutMs: 9000 } }),
      service.updateControlSettings({ computer: { executable: '/opt/cua-driver' } }),
    ])
    const stored = { browser: { enabled: false, timeoutMs: 9000 }, computer: { executable: '/opt/cua-driver' } }
    expect(await service.getControlSettings()).toEqual(stored)
    expect(JSON.parse(await readFile(join(directory, 'janusx/config.json'), 'utf8')).controlSettings).toEqual(stored)
    expect(await new ConfigService().getControlSettings()).toEqual(stored)
  })
})
