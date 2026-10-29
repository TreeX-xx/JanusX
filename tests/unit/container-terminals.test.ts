import { describe, expect, it, vi, afterEach } from 'vitest'
import { ContainerTerminals } from '../../src/main/plugins/container-terminals'
const h = vi.hoisted(() => ({ children: [] as any[] }))
vi.mock('node-pty', () => ({ spawn: vi.fn((executable, args, options) => {
  const child: any = { executable, args, options, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: (callback: any) => { child.data = callback }, onExit: (callback: any) => { child.exit = callback } }
  h.children.push(child); return child
}) }))
afterEach(() => { h.children.length = 0; vi.clearAllMocks() })
const input = { executable: process.platform === 'win32' ? 'C:/Docker/docker.exe' : '/usr/local/bin/docker', endpoint: 'npipe:////./pipe/docker_engine', container: 'a'.repeat(64), shell: '/bin/sh', cols: 80, rows: 24 }
describe('activation-owned container PTYs', () => {
  it('uses structured argv, retains one shell per engine/container, and accepts no remote or arbitrary command', () => {
    const manager = new ContainerTerminals(), first = manager.open(input)
    expect(manager.open({ ...input, shell: '/bin/bash' }).id).toBe(first.id)
    expect(h.children).toHaveLength(1)
    expect(h.children[0].args).toEqual(['--host', input.endpoint, 'exec', '-it', input.container, '/bin/sh'])
    expect(() => manager.open({ ...input, shell: '/bin/sh;rm -rf /' })).toThrow()
    expect(() => manager.open({ ...input, endpoint: 'ssh://remote' })).toThrow()
    expect(() => manager.open({ ...input, executable: 'cmd.exe' })).toThrow()
    manager.dispose()
  })
  it('drains output without a page, bounds replay and reports a slow consumer gap', () => {
    const manager = new ContainerTerminals(), first = manager.open(input)
    h.children[0].data('x'.repeat(300_000))
    const replay = manager.read(first.id, 0)
    expect(replay.truncated).toBe(true); expect(replay.data.length).toBe(256 * 1024); expect(replay.cursor).toBe(300_000)
    h.children[0].data('new output')
    expect(manager.read(first.id, replay.cursor)).toMatchObject({ data: 'new output', truncated: false })
    manager.dispose()
  })
  it('resizes and writes only valid bounded requests, closes one shell and recreates an exited shell', () => {
    const manager = new ContainerTerminals(), first = manager.open(input)
    manager.write(first.id, 'pwd\r'); manager.resize(first.id, 120, 40)
    expect(h.children[0].write).toHaveBeenCalledWith('pwd\r'); expect(h.children[0].resize).toHaveBeenCalledWith(120, 40)
    expect(() => manager.resize(first.id, 10000, 0)).toThrow()
    expect(() => manager.write(first.id, 'x'.repeat(20000))).toThrow()
    manager.close(first.id); expect(h.children[0].kill).toHaveBeenCalledOnce(); expect(manager.read(first.id, 0).exited).toBe(true)
    const second = manager.open(input); expect(second.id).not.toBe(first.id)
    h.children[1].exit({ exitCode: 127 }); expect(manager.read(second.id, 0)).toMatchObject({ exited: true, exitCode: 127 })
    manager.dispose()
  })
  it('limits live shells and kills every owned session on activation disposal', () => {
    const manager = new ContainerTerminals()
    for (let i = 0; i < 8; i++) manager.open({ ...input, container: i.toString(16).repeat(64) })
    expect(() => manager.open(input)).toThrow('terminal-limit')
    manager.dispose()
    for (const child of h.children) expect(child.kill).toHaveBeenCalledOnce()
    expect(() => manager.open(input)).toThrow('terminal-stopped')
  })
})
