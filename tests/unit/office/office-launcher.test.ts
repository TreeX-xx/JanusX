import { EventEmitter } from 'events'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseOfficeLauncherArgs, runOfficeLauncher } from '../../../src/main/office/office-launcher'
import { configureCodexOfficeMcpText, configureOfficeRuleText } from '../../../src/main/office/office-project-rules'

const roots: string[] = []
async function temp(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'janusx-office-launcher-')); roots.push(value); return value }
let ambientOfficecliBinary: string | undefined
afterEach(async () => {
  if (ambientOfficecliBinary === undefined) delete process.env.JANUSX_OFFICECLI_BINARY
  else process.env.JANUSX_OFFICECLI_BINARY = ambientOfficecliBinary
  ambientOfficecliBinary = undefined
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})

describe('Office external launcher', () => {
  it('parses run arguments only after the separator', () => {
    expect(parseOfficeLauncherArgs(['status'])).toEqual({ command: 'status' })
    expect(parseOfficeLauncherArgs(['run', '--engine', 'codex', '--workspace', 'C:\\work', '--', '--model', 'a b'])).toEqual({
      command: 'run', engine: 'codex', workspace: 'C:\\work', args: ['--model', 'a b'],
    })
    expect(() => parseOfficeLauncherArgs(['run', '--engine', 'unknown', '--workspace', '.'])).toThrow()
  })

  it('previews, applies, idempotently re-applies, and reverses project configuration', async () => {
    const root = await temp()
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, '.codex'), { recursive: true })
    const rules = '\uFEFFuser rules\r\nkeep'
    const config = '\uFEFF[features]\r\nhooks = true'
    await writeFile(join(workspace, 'AGENTS.md'), rules)
    await writeFile(join(workspace, '.codex', 'config.toml'), config)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(runOfficeLauncher(['configure', '--workspace', workspace], { mcpEntry: 'office-mcp.js' })).resolves.toBe(2)
    await expect(readFile(join(workspace, 'AGENTS.md'), 'utf8')).resolves.toBe(rules)
    await expect(runOfficeLauncher(['configure', '--workspace', workspace, '--apply'], { mcpEntry: 'office-mcp.js' })).resolves.toBe(0)
    const configured = await readFile(join(workspace, 'AGENTS.md'), 'utf8')
    await expect(runOfficeLauncher(['configure', '--workspace', workspace, '--apply'], { mcpEntry: 'office-mcp.js' })).resolves.toBe(0)
    await expect(readFile(join(workspace, 'AGENTS.md'), 'utf8')).resolves.toBe(configured)
    await expect(runOfficeLauncher(['unconfigure', '--workspace', workspace, '--apply'], { mcpEntry: 'office-mcp.js' })).resolves.toBe(0)
    await expect(readFile(join(workspace, 'AGENTS.md'), 'utf8')).resolves.toBe(rules)
    await expect(readFile(join(workspace, '.codex', 'config.toml'), 'utf8')).resolves.toBe(config)
    output.mockRestore()
  })

  it('launches with preserved argv, bundled env, canonical cwd, and child exit code', async () => {
    ambientOfficecliBinary = process.env.JANUSX_OFFICECLI_BINARY
    delete process.env.JANUSX_OFFICECLI_BINARY
    const root = await temp()
    const workspace = join(root, 'workspace')
    const bundled = join(root, 'officecli.exe')
    await mkdir(workspace)
    await mkdir(join(workspace, '.codex'))
    await writeFile(join(workspace, 'AGENTS.md'), configureOfficeRuleText(''))
    await writeFile(join(workspace, '.codex', 'config.toml'), configureCodexOfficeMcpText(''))
    await writeFile(bundled, 'binary')
    const child = new EventEmitter() as any
    child.killed = false
    child.kill = vi.fn()
    const spawn = vi.fn(() => { queueMicrotask(() => child.emit('exit', 7, null)); return child })
    const launcherDeps = {
      bundledBinary: bundled, mcpEntry: 'office-mcp.js', env: { PATH: 'base' }, spawn,
    } as any
    await expect(runOfficeLauncher(['run', '--engine', 'claude', '--workspace', workspace], launcherDeps)).rejects.toThrow(/no verified Office/)
    await expect(runOfficeLauncher(['run', '--engine', 'opencode', '--workspace', workspace], launcherDeps)).rejects.toThrow(/no verified Office/)
    expect(spawn).not.toHaveBeenCalled()
    const launched = runOfficeLauncher(['run', '--engine', 'codex', '--workspace', workspace, '--', '--flag', 'a b'], {
      ...launcherDeps,
    })
    await expect(launched).resolves.toBe(7)
    expect(spawn).toHaveBeenCalledWith('codex', ['--flag', 'a b'], expect.objectContaining({ cwd: workspace, shell: false, stdio: 'inherit' }))
    expect(spawn.mock.calls[0][2].env).toMatchObject({ JANUSX_OFFICECLI_BINARY: bundled })
    expect(process.env.JANUSX_OFFICECLI_BINARY).toBeUndefined()
  })

  it('reports bundled status without a managed install', async () => {
    const root = await temp()
    const bundled = join(root, 'officecli.exe')
    await writeFile(bundled, 'binary')
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(runOfficeLauncher(['status'], { bundledBinary: bundled, mcpEntry: 'office-mcp.js' })).resolves.toBe(0)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"state":"ready"'))
    output.mockRestore()
  })

  it('resolves macOS resources and the explicit override through the launcher', async () => {
    const root = await temp()
    const bundled = join(root, 'officecli', `darwin-${process.arch}`, 'officecli')
    await mkdir(join(bundled, '..'), { recursive: true })
    await writeFile(bundled, 'binary')
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await runOfficeLauncher(['status'], { resourcesPath: root, platform: 'darwin', env: {} })
      expect(JSON.parse(output.mock.calls.at(-1)![0] as string)).toMatchObject({ state: 'ready', binary: bundled })
      const override = join(root, 'override')
      await writeFile(override, 'binary')
      await runOfficeLauncher(['status'], { resourcesPath: root, platform: 'darwin', env: { JANUSX_OFFICECLI_BINARY: override } })
      expect(JSON.parse(output.mock.calls.at(-1)![0] as string)).toMatchObject({ state: 'ready', binary: override })
    } finally {
      output.mockRestore()
    }
  })
})
