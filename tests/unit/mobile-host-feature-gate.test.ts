import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ features: vi.fn(), workspace: vi.fn(), window: vi.fn(), qr: vi.fn(async (_payload: string) => 'qr'), signal: vi.fn(), ipc: vi.fn(), outputOn: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => 'profile', getAppPath: () => '.', on: vi.fn() }, BrowserWindow: mocks.window, ipcMain: { on: mocks.ipc } }))
vi.mock('../../src/main/config/service', () => ({ configService: { getExperimentalFeatures: mocks.features } }))
vi.mock('../../src/main/terminal/manager', () => ({ terminalManager: { getInstance: () => ({ status: 'running', pty: { onExit: vi.fn() } }), getOutputReplay: () => ({ data: 'history', seq: 1 }) }, terminalOutputEvents: { off: vi.fn(), on: mocks.outputOn } }))
vi.mock('../../src/main/ipc/terminal-handlers', () => ({ createCompanionTerminal: vi.fn(async () => ({ pid: 123 })), submitCompanionTerminalLine: vi.fn() }))
vi.mock('../../src/main/companion/workspace-registry', () => ({ listRegisteredWorkspaces: async () => [], resolveRegisteredWorkspace: mocks.workspace }))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }))
vi.mock('../../src/main/remote/signaling', () => ({ startSignaling: mocks.signal }))
vi.mock('node:os', async importOriginal => ({ ...(await importOriginal<typeof import('node:os')>()), networkInterfaces: () => ({ Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.31.5' }] }) }))
import { startMobileHost, stopMobileHost, mobileHostStatus, approveMobile, refreshMobileQr } from '../../src/main/remote/mobile-host'

describe('mobile host experimental feature gate', () => {
  it('rejects starting the host while disabled, even via direct IPC', async () => {
    mocks.features.mockResolvedValue({ remoteControl: false })
    await expect(startMobileHost({ workspaceId: 'w', signalUrl: 'ws://localhost/signal', stunUrl: '' })).rejects.toThrow('创新功能')
    expect(mocks.window).not.toHaveBeenCalled()
    expect((await mobileHostStatus()).running).toBe(false)
  })
  it('cancels an in-flight activation when the feature is stopped', async () => {
    mocks.features.mockResolvedValue({ remoteControl: true })
    let resolveWorkspace!: () => void
    mocks.workspace.mockImplementationOnce(() => new Promise<void>(resolve => { resolveWorkspace = resolve }))
    const starting = startMobileHost({ workspaceId: 'w', signalUrl: 'ws://localhost/signal', stunUrl: '' })
    await vi.waitFor(() => expect(resolveWorkspace).toBeTypeOf('function'))
    await stopMobileHost(); resolveWorkspace()
    await expect(starting).rejects.toThrow('取消')
    expect(mocks.window).not.toHaveBeenCalled()
    expect((await mobileHostStatus()).running).toBe(false)
  })
  it('puts the configured public endpoint into the QR without starting a private signal service', async () => {
    mocks.features.mockResolvedValue({ remoteControl: true })
    mocks.window.mockImplementation(function () {
      return { webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() }, on: vi.fn(),
        isDestroyed: () => false, destroy: vi.fn(), loadFile: vi.fn(), loadURL: vi.fn() }
    })
    await startMobileHost({ workspaceId: 'w', signalUrl: 'wss://signal.example.com/signal', stunUrl: 'stun:stun.example.com:3478' })
    expect(mocks.signal).not.toHaveBeenCalled()
    const payload = JSON.parse(mocks.qr.mock.calls.at(-1)![0] as string)
    expect(payload).toMatchObject({ signalUrl: 'wss://signal.example.com/signal', stun: 'stun:stun.example.com:3478', v: 1 })
    expect(await mobileHostStatus()).toMatchObject({ signalUrl: payload.signalUrl, localSignal: false, running: true })
    await stopMobileHost()
    expect((await mobileHostStatus()).signalUrl).toBeUndefined()
  })
  it('rejects a stale manually selected interface before binding a local signal service', async () => {
    await expect(startMobileHost({ workspaceId: 'w', signalUrl: '', stunUrl: '', localAddress: '169.254.1.2' })).rejects.toThrow('网卡')
    expect(mocks.signal).not.toHaveBeenCalled()
  })
  it('uses the explicitly selected available interface in local QR codes', async () => {
    const address = (await mobileHostStatus()).lanAddresses![0].address
    mocks.signal.mockResolvedValueOnce({ port: 43821, close: vi.fn() })
    await startMobileHost({ workspaceId: 'w', signalUrl: '', stunUrl: '', localAddress: address })
    expect(JSON.parse(mocks.qr.mock.calls.at(-1)![0])).toMatchObject({ signalUrl: `ws://${address}:43821/signal` })
    expect(await mobileHostStatus()).toMatchObject({ localSignal: true })
    await stopMobileHost()
  })
  it('automatically rotates expired credentials while keeping authorized transport, output and reconnect alive', async () => {
    mocks.workspace.mockResolvedValue({ path: '.' })
    vi.useFakeTimers()
    const windows: any[] = []
    mocks.window.mockImplementation(function () {
      const window = { webContents: { on: vi.fn(), send: vi.fn(), mainFrame: {}, setWindowOpenHandler: vi.fn() },
        on: vi.fn(), isDestroyed: () => false, destroy: vi.fn(), loadFile: vi.fn(), loadURL: vi.fn() }
      windows.push(window); return window
    })
    const bridge = mocks.ipc.mock.calls.find(call => call[0] === 'remote:transport')![1]
    try {
      await startMobileHost({ workspaceId: 'w', signalUrl: 'wss://signal.example.com/signal', stunUrl: '' })
      const original = JSON.parse(mocks.qr.mock.calls.at(-1)![0])
      const window = windows[0], event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
      const message = async (data: object) => { bridge(event, { type: 'message', text: JSON.stringify(data) }); await vi.advanceTimersByTimeAsync(0) }
      bridge(event, { type: 'status', text: '手机已接入，正在协商 UDP 直连' })
      expect((await mobileHostStatus()).state).toContain('正在协商')
      bridge(event, { type: 'open' })
      await message({ type: 'hello', secret: original.secret, deviceId: 'android-device-1234', name: 'Android' })
      approveMobile('android-device-1234')
      const token = window.webContents.send.mock.calls.at(-1)[1].data.token
      await message({ id: 'create', method: 'create' })
      const terminalId = (await mobileHostStatus()).terminals[0].id
      await message({ id: 'subscribe', method: 'subscribe', terminalId })
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      const renewed = JSON.parse(mocks.qr.mock.calls.at(-1)![0])
      expect(renewed.invite).not.toBe(original.invite)
      expect(renewed.secret).not.toBe(original.secret)
      expect(renewed.expiresAt).toBeGreaterThan(original.expiresAt)
      expect(window.destroy).not.toHaveBeenCalled()
      expect(await mobileHostStatus()).toMatchObject({ connectedDeviceId: 'android-device-1234', terminals: [{ id: terminalId }] })
      mocks.outputOn.mock.calls.at(-1)![1](terminalId, 'live after QR refresh', 2)
      expect(window.webContents.send.mock.calls.at(-1)[1].data).toMatchObject({ type: 'output', data: 'live after QR refresh' })
      bridge(event, { type: 'close' }); bridge(event, { type: 'open' })
      await message({ type: 'hello', secret: original.secret, deviceId: 'different-device-1234', name: 'Other' })
      expect(window.webContents.send.mock.calls.at(-1)[1].data).toMatchObject({ type: 'error', message: expect.stringContaining('过期') })
      await message({ type: 'hello', secret: original.secret, deviceId: 'android-device-1234', name: 'Android', token })
      expect((await mobileHostStatus()).connectedDeviceId).toBe('android-device-1234')
      const unused = windows[1]
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(unused.destroy).toHaveBeenCalledOnce()
      expect(window.destroy).not.toHaveBeenCalled()
    } finally { await stopMobileHost(); vi.useRealTimers() }
  })
  it('cancels a delayed QR renewal when remote is stopped', async () => {
    await startMobileHost({ workspaceId: 'w', signalUrl: 'wss://signal.example.com/signal', stunUrl: '' })
    let finish!: (value: string) => void
    mocks.qr.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const renewal = refreshMobileQr()
    await stopMobileHost(); finish('late-qr')
    await expect(renewal).rejects.toThrow('取消')
    expect(await mobileHostStatus()).toMatchObject({ running: false, qr: undefined })
  })
  it('keeps the current host on QR generation failure and retries automatically', async () => {
    vi.useFakeTimers()
    try {
      await startMobileHost({ workspaceId: 'w', signalUrl: 'wss://signal.example.com/signal', stunUrl: '' })
      const original = await mobileHostStatus()
      mocks.qr.mockRejectedValueOnce(Error('QR generation failed'))
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(await mobileHostStatus()).toMatchObject({ running: true, expiresAt: original.expiresAt, qrError: 'QR generation failed' })
      await vi.advanceTimersByTimeAsync(5000)
      const renewed = await mobileHostStatus()
      expect(renewed.expiresAt).toBeGreaterThan(original.expiresAt!)
      expect(renewed.qrError).toBeUndefined()
    } finally { await stopMobileHost(); vi.useRealTimers() }
  })
})
