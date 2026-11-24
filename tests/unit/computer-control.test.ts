import { beforeEach, expect, it, vi } from 'vitest'

const { call, settings } = vi.hoisted(() => ({
  call: vi.fn(), settings: { computer: { enabled: true, executable: '/test/driver' } },
}))
vi.mock('electron', () => ({ app: { getPath: () => '.' } }))
vi.mock('../../src/main/platform/local-platform', () => ({ localPlatform: () => 'darwin' }))
vi.mock('../../src/main/platform/process-host', () => ({ runProcess: vi.fn(async () => ({ exitCode: 1 })) }))
vi.mock('../../src/main/config/service', () => ({ configService: { getControlSettings: async () => settings } }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  connect = vi.fn(async () => {})
  close = vi.fn(async () => {})
  callTool = call
} }))
import { beginComputerTurn, callComputer, computerActivities, computerStatus, endComputerTurn, resetComputer } from '../../src/main/computer/control'
const signal = new AbortController().signal
const invoke = (id: string, name: string, args = {}) => callComputer(id, name, args, signal)
const reply = (structuredContent: unknown) => ({ content: [], structuredContent })
const granted = { accessibility: true, screen_recording: true }
beforeEach(() => {
  resetComputer()
  settings.computer.enabled = true
  call.mockReset().mockImplementation(async ({ name }) => {
    if (name === 'check_permissions') return reply(granted)
    if (name === 'list_windows') return reply({ windows: [{ pid: 333, window_id: 1, app_name: 'Fixture', title: 'Target' }] })
    if (name === 'get_window_state') return reply({ elements: [{ element_token: 'snapshot:1' }] })
    return reply({ ok: true })
  })
})
it('requires a discovered and exclusively selected window and a fresh element token', async () => {
  for (const id of ['a', 'b']) await beginComputerTurn(id, id)
  await expect(invoke('a', 'select_window', { window: '333/1' })).rejects.toThrow('List available')
  await invoke('a', 'list_windows', { app: 'Fixture' })
  await invoke('b', 'list_windows', { app: 'Fixture' })
  await invoke('a', 'select_window', { window: '333/1' })
  await expect(invoke('b', 'select_window', { window: '333/1' })).rejects.toThrow('List available')
  expect(computerActivities()).toEqual([{ owner: 'a', runId: 'a', target: 'Fixture · Target' }])
  await invoke('a', 'read_window')
  await expect(invoke('a', 'click', { element: 'snapshot:1', delivery_mode: 'foreground' })).rejects.toThrow()
  await invoke('a', 'click', { element: 'snapshot:1' })
  expect(call.mock.calls.find(([req]) => req.name === 'click')?.[0].arguments).toMatchObject({ pid: 333, window_id: 1, delivery_mode: 'background' })
  await expect(invoke('a', 'click', { element: 'snapshot:1' })).rejects.toThrow('fresh element')
  endComputerTurn('a')
  await invoke('b', 'select_window', { window: '333/1' })
})
it('revokes in-flight and queued calls across disabling and re-enabling', async () => {
  await beginComputerTurn('old', 'one')
  let enter!: () => void, finish!: () => void
  const entered = new Promise<void>(ok => { enter = ok })
  call.mockImplementation(async ({ name }) => {
    if (name === 'check_permissions') return reply(granted)
    enter()
    await new Promise<void>(ok => { finish = ok })
    return reply({ windows: [] })
  })
  const first = invoke('old', 'list_windows', { app: 'Test' })
  const queued = invoke('old', 'list_windows', { app: 'Test' })
  await entered
  settings.computer.enabled = false
  resetComputer()
  settings.computer.enabled = true
  finish()
  expect((await Promise.allSettled([first, queued])).map(r => r.status)).toEqual(['rejected','rejected'])
  expect(call.mock.calls.filter(([req]) => req.name === 'list_windows')).toHaveLength(1)
  expect(() => invoke('old', 'list_windows')).toThrow('stopped')
  await beginComputerTurn('new', 'one')
})
it('blocks a previously available turn when platform permission is revoked', async () => {
  await beginComputerTurn('id', 'owner')
  call.mockResolvedValue(reply({ ...granted, accessibility: false }))
  expect(await computerStatus()).toMatchObject({ connected: false, missingPermissions: ['accessibility'] })
  call.mockResolvedValue(reply(granted))
  expect(() => invoke('id', 'list_windows')).toThrow('stopped')
  settings.computer.enabled = false
  await expect(beginComputerTurn('disabled', 'owner')).rejects.toThrow('disabled')
})
