import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { createProcessHost } from '../../src/main/platform/process-host/core'
import { resolveProcessSpawn } from '../../src/main/platform/process-host/spawn-resolution'
vi.mock('../../src/main/shutdown/diagnostics', () => ({ logShutdown: vi.fn() }))
import { stopProcessTree } from '../../src/main/shutdown/process-tree'

const host = createProcessHost({ stop: stopProcessTree })
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'janusx-process-')); directories.push(dir); return dir }

describe('real local process contract', () => {
  it('preserves structured argv and waits for stdout/stderr close', async () => {
    const args = ['', 'with spaces', '中文', 'a"b', "a'b", 'line1\nline2', 'x&whoami', '%PATH%', '!value!', 'trailing\\']
    const result = await host.run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)));process.stderr.write("tail")', '--', ...args])
    expect(result.status).toBe('exited'); expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(args); expect(result.stderr).toBe('tail')
  })
  it('distinguishes a launch failure and an unsuccessful exit', async () => {
    expect((await host.run(join(temp(), 'missing-program'))).status).toBe('spawn-error')
    expect(await host.run(process.execPath, ['-e', 'process.exit(23)'])).toMatchObject({ status: 'exited', exitCode: 23 })
  })
  it('pipes stdin without unbounded output', async () => {
    const result = await host.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: '中文\n' })
    expect(result.stdout).toBe('中文\n')
    const overflow = await host.run(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("x".repeat(4096)),5)'], { maxOutputBytes: 1024 })
    expect(overflow.status).toBe('output-limit'); expect(overflow.truncated).toBe(true); expect(overflow.stdout.length).toBe(1024)
  }, 20_000)
  it('confirms timeout termination', async () => {
    const result = await host.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 })
    expect(result.status).toBe('timed-out')
  }, 20_000)
  it('cancels the owned process tree and confirms a spawned descendant is gone', async () => {
    const controller = new AbortController()
    let output = ''
    const result = await host.run(process.execPath, ['-e', 'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log(c.pid);setInterval(()=>{},1000)'], {
      signal: controller.signal, timeoutMs: 10_000,
      onStdout: chunk => { output += chunk; if (output.includes('\n')) controller.abort() },
    })
    expect(result.status).toBe('cancelled')
    const pid = Number(output.trim()); expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
  }, 25_000)
  it('reports unconfirmed stop instead of a successful cancellation', async () => {
    let child: ChildProcess | undefined
    const brokenStop = createProcessHost({ stop: async proc => { child = proc; throw new Error('fixture stop denied') } })
    try {
      const result = await brokenStop.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 })
      expect(result.status).toBe('exit-unconfirmed'); expect(result.error?.message).toContain('denied')
    } finally { if (child) await stopProcessTree(child, { processGroup: true }) }
  }, 20_000)
  it('does not launch an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort()
    expect(await host.run('missing-command', [], { signal: controller.signal })).toMatchObject({ status: 'cancelled', exitCode: null })
  })
  it.skipIf(process.platform !== 'win32')('runs a standard npm shim with multiline argv without a command shell', async () => {
    const directory = temp(), script = join(directory, 'echo args.cjs'), shim = join(directory, 'fixture.cmd')
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
    const body = readFileSync('node_modules/.bin/vitest.cmd', 'utf8').replace('%dp0%\\..\\vitest\\vitest.mjs', '%dp0%\\echo args.cjs')
    writeFileSync(shim, body)
    const env = { ...process.env, PATH: dirname(process.execPath) }
    const args = ['a\nb', '', '" & %PATH% !中文!']
    expect(resolveProcessSpawn(shim, args, env, 'win32')).toMatchObject({ program: process.execPath, batch: false })
    const result = await host.run(shim, args, { env })
    expect(result.status).toBe('exited'); expect(JSON.parse(result.stdout)).toEqual(args)
    const fromPath = await host.run('fixture', args, { env: { ...env, PATH: `${directory};${dirname(process.execPath)}` } })
    expect(fromPath.status).toBe('exited'); expect(JSON.parse(fromPath.stdout)).toEqual(args)
  })
  it.skipIf(process.platform !== 'win32')('keeps custom batch setup and rejects unsafe multiline input', async () => {
    const shim = join(temp(), 'custom.cmd')
    writeFileSync(shim, '@echo off\r\necho custom-setup\r\n')
    expect(await host.run(shim)).toMatchObject({ status: 'exited', exitCode: 0, stdout: expect.stringContaining('custom-setup') })
    const rejected = await host.run(shim, ['line1\nline2'])
    expect(rejected.status).toBe('spawn-error'); expect(rejected.error?.message).toContain('Multiline')
  })
})
