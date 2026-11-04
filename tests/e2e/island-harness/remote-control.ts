import { DEFAULT_EXPERIMENTAL_FEATURES } from '../../../src/shared/ipc/experimental'
import type { MobileHostStatus } from '../../../src/shared/ipc/remote'

const fixture = {
  failSave: false,
  starts: 0,
  disables: 0,
  status: { running: false, state: 'Ready', terminals: [], devices: [],
    workspaces: [{ id: 'intro-project', name: 'Intro project', path: 'C:/intro-project' }] } as MobileHostStatus,
}
const features = () => ({ ...DEFAULT_EXPERIMENTAL_FEATURES, remoteControl: localStorage.getItem('fixture:remote') === 'true' })
Object.assign(window.electron.experimental, {
  get: async () => features(),
  update: async (value: { remoteControl?: boolean }) => {
    if (fixture.failSave) throw new Error('Fixture save failure')
    localStorage.setItem('fixture:remote', String(value.remoteControl))
    if (!value.remoteControl) { fixture.disables++; fixture.status.running = false; delete fixture.status.connectedDeviceId; delete fixture.status.pending }
    return features()
  },
})
Object.assign(window.electron.remote, {
  status: async () => structuredClone(fixture.status),
  start: async (options: { workspaceId: string }) => {
    fixture.starts++
    Object.assign(fixture.status, { running: true, workspaceId: options.workspaceId, state: 'Waiting for scan', expiresAt: Date.now() + 60000,
      qr: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/><rect x="8" y="8" width="48" height="48" fill="black"/></svg>' })
    return structuredClone(fixture.status)
  },
  approve: async () => {
    Object.assign(fixture.status, { connectedDeviceId: 'phone', state: 'Connected', terminals: [{ id: 'remote-session', pid: 123, alive: true }] })
    delete fixture.status.pending
    return structuredClone(fixture.status)
  },
})
Object.assign(window, { remoteFixture: fixture })
