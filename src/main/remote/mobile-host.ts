import { localDefaultShell } from '../platform/local-shell'
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { startSignaling } from './signaling'
import { MobileSession } from './mobile-session'
import { terminalManager, terminalOutputEvents } from '../terminal/manager'
import { createCompanionTerminal, submitCompanionTerminalLine } from '../ipc/terminal-handlers'
import { listRegisteredWorkspaces, resolveRegisteredWorkspace } from '../companion/workspace-registry'
import type { MobileHostOptions, MobileHostStatus } from '../../shared/ipc/remote'
import { configService } from '../config/service'
import { lanAddresses, validateSignalUrl } from './network'
import { REMOTE_LAN_ONLY } from '../../shared/remote-scope'
import { appShutdown } from '../shutdown/AppShutdown'
import { assertApplicationRunning } from '../shutdown/quit-state'

// Note: .agents/notes/remote/android-pairing-handshake.md
const BRIDGE = 'remote:transport'
const PAIRING_TTL = 5 * 60 * 1000
type HostEntry = { window: BrowserWindow; session: MobileSession; state: string; qr: string }
const hosts = new Map<BrowserWindow, HostEntry>()
let current: HostEntry | undefined
let latest: HostEntry | undefined
let options: MobileHostOptions | undefined
let localSignal: Awaited<ReturnType<typeof startSignaling>> | undefined
let starting = false, refreshing = false, generation = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let qrError: string | undefined
const workspacesRoot = () => join(app.getPath('userData'), 'janusx', 'workspaces')
function sendTransport(entry: HostEntry, data: unknown) {
  if (hosts.has(entry.window) && !entry.window.isDestroyed()) entry.window.webContents.send(BRIDGE, data)
}
const allHosts = () => [...hosts.values()]
const deviceCount = () => allHosts().reduce((count, entry) => count + entry.session.devices.size, 0)
export async function mobileHostStatus(): Promise<MobileHostStatus> {
  const entries = allHosts()
  const connected = entries.find(entry => entry.session.connectedDeviceId)
  const pending = entries.find(entry => entry.session.pending)?.session.pending
  return {
    running: Boolean(current),
    state: connected ? '手机已授权连接' : pending ? '手机申请授权，等待电脑批准' : (latest ?? current)?.state ?? '已关闭',
    qr: current?.qr, expiresAt: current?.session.expiresAt, qrError,
    signalUrl: options?.signalUrl, localSignal: Boolean(localSignal), lanAddresses: lanAddresses(),
    workspaceId: options?.workspaceId, connectedDeviceId: connected?.session.connectedDeviceId, pending,
    terminals: entries.flatMap(entry => entry.session.listTerminals()),
    devices: [...new Map(entries.flatMap(entry => [...entry.session.devices.values()]).map(({ id, name }) => [id, { id, name }])).values()],
    workspaces: await listRegisteredWorkspaces(workspacesRoot()),
  }
}
function onOutput(id: string, data: string, seq: number) {
  for (const entry of hosts.values()) entry.session.output(id, data, seq)
}
function disposeHost(entry: HostEntry) {
  hosts.delete(entry.window)
  entry.session.disconnect()
  if (latest === entry) latest = undefined
  if (!entry.window.isDestroyed()) entry.window.destroy()
}
export async function stopMobileHost(): Promise<void> {
  generation++
  clearTimeout(refreshTimer); refreshTimer = undefined
  current = undefined; latest = undefined; options = undefined; qrError = undefined
  for (const entry of allHosts()) disposeHost(entry)
  terminalOutputEvents.off('data', onOutput)
  const signal = localSignal; localSignal = undefined
  await signal?.close()
}
function scheduleRefresh(delay = Math.max(1, (current?.session.expiresAt ?? Date.now()) - Date.now())) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { void refreshMobileQr().catch(() => { /* Error is exposed in status; retry is scheduled below. */ }) }, delay)
  refreshTimer.unref?.()
}
/** Rotate only pairing credentials; authorized transports survive until revoked/stopped. */
export async function refreshMobileQr(): Promise<void> {
  if (!options || refreshing) return
  refreshing = true
  const activation = generation, selected = options
  try {
    const entry = await createHost(selected, activation)
    if (activation !== generation) { disposeHost(entry); return }
    const previous = current
    current = entry; qrError = undefined
    if (previous && previous.session.devices.size === 0) disposeHost(previous)
    scheduleRefresh()
  } catch (error) {
    if (activation === generation && options) {
      qrError = error instanceof Error ? error.message : String(error)
      scheduleRefresh(5000)
    }
    throw error
  } finally { refreshing = false }
}
async function createHost(selected: MobileHostOptions, activation: number): Promise<HostEntry> {
  const invite = randomBytes(24).toString('hex'), secret = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + PAIRING_TTL
  const active = new MobileSession(selected.workspaceId, expiresAt, secret, {
    async create(id, workspaceId) {
      const record = await resolveRegisteredWorkspace(workspacesRoot(), workspaceId)
      const result = await createCompanionTerminal({ id, workspaceId, cwd: record.path, preset: 'claude',
        shell: localDefaultShell(), cols: 80, rows: 30 })
      terminalManager.getInstance(id)?.pty.onExit(({ exitCode }) => active.exited(id, exitCode))
      return result
    },
    input: submitCompanionTerminalLine, keys: (id, data) => terminalManager.write(id, data),
    resize: (id, cols, rows) => terminalManager.resize(id, cols, rows),
    replay: id => terminalManager.getOutputReplay(id),
    alive: id => { const t = terminalManager.getInstance(id); return Boolean(t && t.status !== 'exited') },
    geometry: id => { const t = terminalManager.getInstance(id); return { cols: t?.lastCols ?? 80, rows: t?.lastRows ?? 30 } },
  }, () => {})
  const qr = await QRCode.toDataURL(JSON.stringify({ v: 1, signalUrl: selected.signalUrl, invite, secret, stun: selected.stunUrl, expiresAt }), { scale: 8, margin: 4, errorCorrectionLevel: 'M' })
  if (activation !== generation) throw Error('远程开启已取消')
  const hostWindow = new BrowserWindow({ show: false, webPreferences: {
    preload: join(app.getAppPath(), 'out/preload/remote.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } })
  const entry: HostEntry = { window: hostWindow, session: active, state: '等待手机扫码', qr }
  hosts.set(hostWindow, entry)
  hostWindow.webContents.on('preload-error', () => { entry.state = '远程通信桥加载失败，请重启更新后的 JanusX'; latest = entry })
  hostWindow.webContents.on('render-process-gone', () => { active.disconnect(); entry.state = '远程连接进程已退出，请关闭远程后重新开启'; latest = entry })
  hostWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  hostWindow.webContents.on('will-navigate', event => event.preventDefault())
  hostWindow.webContents.on('did-finish-load', () => sendTransport(entry, { type: 'start', signalUrl: localSignal ? `ws://127.0.0.1:${localSignal.port}/signal` : selected.signalUrl, invite, secret, stun: selected.stunUrl }))
  hostWindow.on('closed', () => {
    if (!hosts.has(hostWindow)) return
    if (current === entry) void stopMobileHost()
    else disposeHost(entry)
  })
  try {
    if (process.env.ELECTRON_RENDERER_URL) await hostWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/remote-host.html`)
    else await hostWindow.loadFile(join(app.getAppPath(), 'out/renderer/remote-host.html'))
    if (activation !== generation) throw Error('远程开启已取消')
    return entry
  } catch (error) { disposeHost(entry); throw error }
}
export async function startMobileHost(input: MobileHostOptions): Promise<void> {
  assertApplicationRunning()
  if (starting) throw Error('远程正在开启')
  if (!input || typeof input.workspaceId !== 'string' || typeof input.signalUrl !== 'string' || typeof input.stunUrl !== 'string') throw Error('远程设置无效')
  starting = true
  try {
    await stopMobileHost()
    const activation = generation
    if (!(await configService.getExperimentalFeatures()).remoteControl) throw Error('请先在设置 → 创新功能中开启远程协作控制')
    if (REMOTE_LAN_ONLY && (input.signalUrl.trim() || input.stunUrl.trim())) throw Error('此发布构建仅支持局域网测试，不支持公网信令或 STUN；请使用开发构建测试跨网')
    await resolveRegisteredWorkspace(workspacesRoot(), input.workspaceId)
    if (activation !== generation) throw Error('远程开启已取消')
    if (input.stunUrl && !/^stun:[^\s]+$/.test(input.stunUrl)) throw Error('只允许 STUN，不支持 TURN')
    let signalUrl = input.signalUrl.trim()
    if (!signalUrl) {
      const addresses = lanAddresses(), address = input.localAddress || addresses[0]?.address
      if (!address || !addresses.some(a => a.address === address)) throw Error('请选择当前可用的局域网网卡，或配置公网信令')
      localSignal = await startSignaling(43821, '0.0.0.0')
      signalUrl = `ws://${address}:${localSignal.port}/signal`
    }
    validateSignalUrl(signalUrl)
    options = { ...input, signalUrl }
    const entry = await createHost(options, activation)
    if (activation !== generation || !(await configService.getExperimentalFeatures()).remoteControl) throw Error('远程开启已取消')
    current = entry; latest = entry
    terminalOutputEvents.on('data', onOutput)
    scheduleRefresh()
  } catch (error) { await stopMobileHost(); throw error }
  finally { starting = false }
}
export function approveMobile(id: string): void {
  const entry = allHosts().find(item => item.session.pending?.id === id)
  if (!entry) throw Error('配对申请不存在或已过期')
  if (deviceCount() >= 8) throw Error('最多授权 8 个设备，请先撤销旧设备')
  entry.session.approve(id)
}
export function rejectMobile(): void { for (const entry of hosts.values()) if (entry.session.pending) entry.session.reject() }
export function revokeMobile(id: string): void {
  for (const entry of allHosts()) {
    entry.session.revoke(id)
    if (entry !== current && entry.session.devices.size === 0) disposeHost(entry)
  }
}
ipcMain.on(BRIDGE, (event, m) => {
  const entry = allHosts().find(item => event.sender === item.window.webContents && event.senderFrame === item.window.webContents.mainFrame)
  if (!entry) return
  if (m?.type === 'open') { entry.session.connect(data => sendTransport(entry, { type: 'send', data })); entry.state = '直连成功，等待配对'; latest = entry }
  if (m?.type === 'close') { entry.session.disconnect(); entry.state = '连接已断开，可重连'; latest = entry }
  if (m?.type === 'status' && typeof m.text === 'string') { entry.state = m.text.slice(0, 300); latest = entry }
  if (m?.type === 'message' && typeof m.text === 'string') void entry.session.receive(m.text)
})
appShutdown.configure({ stopMobileHost })
