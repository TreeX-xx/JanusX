// Note: .agents/notes/workbench/docker-management-entry.md — activation owns sessions, pages only attach.
import { spawn, type IPty } from 'node-pty'
import { basename, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { localDockerEndpoint, type ContainerTerminalOutput } from '@janusx/plugin-sdk'

const request = z.object({ executable: z.string().max(4096).refine(value => isAbsolute(value) && /^docker(?:\.exe)?$/i.test(basename(value))),
  endpoint: z.string().max(4096).transform(localDockerEndpoint), container: z.string().regex(/^[a-f0-9]{64}$/),
  shell: z.enum(['/bin/sh', '/bin/bash', 'cmd.exe', 'powershell.exe']), cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(200) }).strict()
interface Session { id: string; target: string; pty: IPty; buffer: string; cursor: number; exited: boolean; exitCode: number | null }
const LIMIT = 256 * 1024
export class ContainerTerminals {
  private sessions = new Map<string, Session>()
  private disposed = false
  open(input: unknown): ContainerTerminalOutput {
    if (this.disposed) throw new Error('terminal-stopped')
    const value = request.parse(input), target = value.endpoint + ':' + value.container
    let session = [...this.sessions.values()].find(item => item.target === target && !item.exited)
    if (!session) {
      // One live shell per container, at most eight for an activation; exited records are replaceable.
      for (const [id, item] of this.sessions) if (item.exited) this.sessions.delete(id)
      if (this.sessions.size >= 8) throw new Error('terminal-limit')
      const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']
        .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
      const pty = spawn(value.executable, ['--host', value.endpoint, 'exec', '-it', value.container, value.shell], {
        name: 'xterm-256color', cols: value.cols, rows: value.rows, cwd: homedir(), env: { ...env, TERM: 'xterm-256color' }, useConpty: true, useConptyDll: false,
      })
      session = { id: randomUUID(), target, pty, buffer: '', cursor: 0, exited: false, exitCode: null }
      const owned = session
      pty.onData(data => { owned.cursor += data.length; owned.buffer = (owned.buffer + data).slice(-LIMIT) })
      pty.onExit(event => { owned.exited = true; owned.exitCode = event.exitCode })
      this.sessions.set(session.id, session)
    }
    return this.read(session.id, 0)
  }
  private get(id: string): Session { const session = this.sessions.get(id); if (!session || this.disposed) throw new Error('terminal-unavailable'); return session }
  read(id: string, cursor: number): ContainerTerminalOutput {
    const session = this.get(id), start = session.cursor - session.buffer.length
    return { id, data: session.buffer.slice(Math.max(0, cursor - start)), cursor: session.cursor, truncated: cursor < start,
      exited: session.exited, exitCode: session.exitCode }
  }
  write(id: string, data: string): void { const session = this.get(id); if (!session.exited) session.pty.write(z.string().max(16 * 1024).parse(data)) }
  resize(id: string, cols: number, rows: number): void { const session = this.get(id); if (!session.exited) session.pty.resize(z.number().int().min(2).max(500).parse(cols), z.number().int().min(1).max(200).parse(rows)) }
  close(id: string): void { const session = this.sessions.get(id); if (session && !session.exited) { session.exited = true; try { session.pty.kill() } catch { /* Already exited. */ } } }
  dispose(): void { for (const id of this.sessions.keys()) this.close(id); this.sessions.clear(); this.disposed = true }
}
