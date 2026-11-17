import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorWindowManager } from '../../src/main/windows/editor-window'
import { SYSTEM_CHANNELS } from '../../src/shared/ipc/system'

const ipc = vi.hoisted(() => ({ on: vi.fn(), handle: vi.fn(), fromWebContents: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: ipc, BrowserWindow: { fromWebContents: ipc.fromWebContents } }))
import { registerWindowIpc } from '../../src/main/windows/register-window-ipc'

function windowFixture() {
  const events = new EventEmitter()
  let maximized = false
  const window = Object.assign(events, {
    isDestroyed: vi.fn(() => false), isMaximized: vi.fn(() => maximized),
    minimize: vi.fn(), close: vi.fn(),
    maximize: vi.fn(() => { maximized = true; events.emit('maximize') }),
    unmaximize: vi.fn(() => { maximized = false; events.emit('unmaximize') }),
    webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() },
  })
  return window
}

describe('application-scoped window IPC across main-window replacement', () => {
  beforeEach(() => vi.resetAllMocks())

  function register() {
    let current: ReturnType<typeof windowFixture> | null = windowFixture()
    const editors = { list: vi.fn(() => [] as Array<{ webContents: unknown }>), ready: vi.fn(), confirmClose: vi.fn() }
    registerWindowIpc(editors as unknown as EditorWindowManager, () => current as unknown as BrowserWindow | null)
    const handle = (name: string) => ipc.handle.mock.calls.find(([channel]) => channel === name)![1]
    const event = (name: string) => ipc.on.mock.calls.find(([channel]) => channel === name)![1]
    return { main: () => current, replace: (next: typeof current) => { current = next }, editors, handle, event }
  }

  it('controls each requesting window after replacement and observes native state once per window', () => {
    const registered = register(), first = registered.main()!, second = windowFixture()
    ipc.fromWebContents.mockImplementation(sender => sender === first.webContents ? first : second)
    const query = registered.handle(SYSTEM_CHANNELS.getMaximized)
    const toggle = registered.handle(SYSTEM_CHANNELS.maximize)
    const registrationCount = ipc.handle.mock.calls.length
    expect(query({ sender: first.webContents })).toBe(false)
    expect(query({ sender: first.webContents })).toBe(false)
    expect(first.listenerCount('maximize')).toBe(1)
    first.isDestroyed.mockReturnValue(true); registered.replace(second)

    expect(query({ sender: second.webContents })).toBe(false)
    expect(query({ sender: second.webContents })).toBe(false)
    toggle({ sender: second.webContents })
    expect(second.webContents.send).toHaveBeenLastCalledWith(SYSTEM_CHANNELS.maximizedChanged, true)
    toggle({ sender: second.webContents })
    expect(second.webContents.send).toHaveBeenLastCalledWith(SYSTEM_CHANNELS.maximizedChanged, false)
    expect(second.listenerCount('maximize')).toBe(1)
    expect(second.listenerCount('unmaximize')).toBe(1)
    expect(first.maximize).not.toHaveBeenCalled()
    expect(query({ sender: first.webContents })).toBe(false)
    expect(ipc.handle).toHaveBeenCalledTimes(registrationCount)
  })

  it('relays editor observations to the new main window while rejecting the old renderer', () => {
    const registered = register(), first = registered.main()!, second = windowFixture()
    const sender = { id: 'floating-editor' }, payload = { filePath: '/project/a.ts', workspacePath: '/project' }
    registered.editors.list.mockReturnValue([{ webContents: sender }])
    const viewed = registered.event(SYSTEM_CHANNELS.editorViewed)
    first.isDestroyed.mockReturnValue(true); registered.replace(null)
    viewed({ sender }, payload)
    expect(first.webContents.send).not.toHaveBeenCalled()
    registered.replace(second)
    viewed({ sender: first.webContents }, payload)
    expect(second.webContents.send).not.toHaveBeenCalled()
    viewed({ sender }, payload)
    expect(second.webContents.send).toHaveBeenCalledExactlyOnceWith(SYSTEM_CHANNELS.editorViewed, payload)
  })

  it('keeps close and minimize scoped to the sender when an editor and new main coexist', () => {
    const registered = register(), main = windowFixture(), editor = windowFixture()
    registered.replace(main)
    ipc.fromWebContents.mockImplementation(sender => sender === editor.webContents ? editor : main)
    registered.handle(SYSTEM_CHANNELS.close)({ sender: editor.webContents })
    registered.handle(SYSTEM_CHANNELS.minimize)({ sender: main.webContents })
    expect(editor.close).toHaveBeenCalledOnce(); expect(main.close).not.toHaveBeenCalled()
    expect(main.minimize).toHaveBeenCalledOnce(); expect(editor.minimize).not.toHaveBeenCalled()
    registered.event(SYSTEM_CHANNELS.editorReady)({ sender: editor.webContents })
    expect(registered.editors.ready).toHaveBeenCalledExactlyOnceWith(editor.webContents)
  })

  it('does not publish native maximize events to destroyed webContents', () => {
    const registered = register(), main = registered.main()!
    ipc.fromWebContents.mockReturnValue(main)
    registered.handle(SYSTEM_CHANNELS.getMaximized)({ sender: main.webContents })
    main.webContents.isDestroyed.mockReturnValue(true)
    main.maximize()
    expect(main.webContents.send).not.toHaveBeenCalled()
  })
})
