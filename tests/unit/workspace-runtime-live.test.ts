// Opt-in real transport verification. Start tests/integration/workspace-ssh-fixture.py
// in NewAPI-WSL first, then set JANUSX_RUNTIME_LIVE=1 for this suite.
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runtimeResource, type WorkspaceRuntime, type RuntimeTerminal } from '../../src/shared/workspace-runtime'

const settings = vi.hoisted(() => ({ data: '', config: '', home: '' }))
vi.mock('electron', () => ({ app: { getPath: () => settings.data, getAppPath: () => process.cwd(), isPackaged: false }, net: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) } }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (file: string, args: string[], options: any) => {
    // Only isolate HOME and OpenSSH config. All production framing, bootstrap,
    // executable selection, quoting, resource resolution and operations run.
    if (file === 'ssh') args = ['-F', settings.config, ...args]
    if (file === 'wsl.exe') {
      const index = args.indexOf('--exec')
      args = [...args.slice(0, index + 1), 'env', `HOME=${settings.home}`, ...args.slice(index + 1)]
    }
    return actual.spawn(file, args, options)
  } }
})

import { disconnectRuntimeTransports, runtimeRequest } from '../../src/main/workspace/runtime'
import { remoteBackendRequest } from '../../src/main/workspace/remote-harness'
import { detectRemoteCli, installRemoteCli, remoteCliInstallStatus } from '../../src/main/workspace/remote-cli'
import { createRemoteTerminal } from '../../src/main/terminal/remote-pty'
import { createWorktree, listWorktrees, removeWorktree } from '../../src/main/git/worktrees'
import { remoteFileInvocation } from '../../src/main/workspace/runtime-ipc'
import { FILE_CHANNELS } from '../../src/shared/ipc/workspace'
import { HARNESS_COMMAND_CHANNELS as H } from '../../src/shared/ipc/harness'
import { getStatus, stage, unstage, commit, getFileBaseline, getWorkingDiff, discard } from '../../src/main/git/service'
import { HtmlPreviewServer } from '../../src/main/preview/html-preview-server'
import { officecliManager } from '../../src/main/office/officecli-manager'
import { OfficeWatchPool } from '../../src/main/office/office-watch-pool'
import { createProductionOfficeOperations } from '../../src/main/office/office-handler-operations'
import { resolveTrustedOfficeFile } from '../../src/main/office/office-workspace-guard'
import { releaseRemoteOfficePreviews } from '../../src/main/office/remote-office-cache'

const execute = promisify(execFile)
const linux = async (...args: string[]) => (await execute('wsl.exe', ['-d', 'NewAPI-WSL', '--exec', ...args], { encoding: 'utf8', windowsHide: true, timeout: 20000 })).stdout
let fixture: { directory: string; home: string; root: string; port: number; user: string }
let runtime: Exclude<WorkspaceRuntime, { kind: 'windows' }>
let ssh: Exclude<WorkspaceRuntime, { kind: 'windows' }>
const terminalId = (kind: string) => `${kind}-persistent-${settings.data.split(/[\\/]/).pop()}`

describe.skipIf(process.env.JANUSX_RUNTIME_LIVE !== '1')('real WSL and SSH workspace transports', () => {
  it('installs missing Agent CLIs through both Linux transports and starts them without restarting an existing PTY', async () => {
    const sleeper = await runtimeRequest<RuntimeTerminal>(runtime, 'terminal.create', { id: terminalId('cli-install-survivor'), workspaceId: 'wsl-test', cwd: fixture.root, argv: ['/bin/sh', '-c', 'sleep 900'] })
    try {
      for (const [id, tool] of [['wsl-test', 'codex'], ['ssh-test', 'pi']] as const) {
        expect((await detectRemoteCli(id, tool)).installed).toBe(false)
        let job = await installRemoteCli(id, tool)
        expect(job.state).toBe('running')
        expect((await installRemoteCli(id, tool)).state).toBe('running')
        disconnectRuntimeTransports()
        const deadline = Date.now() + 240_000
        while (job.state === 'running' && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1500))
          job = await remoteCliInstallStatus(id, tool)
        }
        expect(job.state, JSON.stringify(job)).toBe('complete')
        const probe = await detectRemoteCli(id, tool)
        expect(probe.installed).toBe(true)
        expect(probe.executable).toContain(fixture.home + '/.local/share/janusx/agents/')
        const launched = await createRemoteTerminal({ id: terminalId(`cli-version-${tool}`), workspaceId: id, cwd: runtimeResource(id, fixture.root), shell: '/bin/sh', preset: tool, command: tool, args: ['--version'] }, () => {})
        let output = ''
        let exit: number | undefined
        launched.instance.pty.onData(data => { output += data })
        launched.instance.pty.onExit(event => { exit = event.exitCode })
        launched.start()
        try {
          await expect.poll(() => exit, { timeout: 30_000 }).toBe(0)
          expect(output).toMatch(/\d+\.\d+/)
        } finally { launched.instance.remote!.detach() }
      }
      const alive = (await runtimeRequest<RuntimeTerminal[]>(runtime, 'terminal.list', { workspaceId: 'wsl-test' })).find(item => item.id === sleeper.id)!
      expect(alive.pid).toBe(sleeper.pid)
      expect(alive.exitCode).toBeNull()
    } finally { await runtimeRequest(runtime, 'terminal.end', { id: sleeper.id, workspaceId: 'wsl-test' }) }
  }, 600_000)
  beforeAll(async () => {
    fixture = JSON.parse(await linux('cat', '/home/newapi/.cache/janusx-workspace-test/active-fixture.json'))
    settings.data = await mkdtemp(join(tmpdir(), 'janusx-runtime-live-'))
    fixture.root += '/' + settings.data.split(/[\\/]/).pop()
    await linux('python3', '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).mkdir()', fixture.root)
    settings.home = fixture.home
    settings.config = join(settings.data, 'ssh_config')
    await writeFile(join(settings.data, 'client_key'), await linux('cat', `${fixture.directory}/client_key`))
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl = New-Object System.Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($identity); $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:JANUSX_TEST_KEY -AclObject $acl'],
    { env: { ...process.env, JANUSX_TEST_KEY: join(settings.data, 'client_key') }, windowsHide: true })
    const hostKey = (await linux('cat', `${fixture.directory}/host_key.pub`)).trim().split(' ').slice(0, 2).join(' ')
    const hosts = join(settings.data, 'known_hosts').replace(/\\/g, '/')
    await writeFile(hosts, `[127.0.0.1]:${fixture.port} ${hostKey}\n`)
    await writeFile(settings.config, `Host janusx-workspace-test\n HostName 127.0.0.1\n Port ${fixture.port}\n User ${fixture.user}\n StrictHostKeyChecking yes\n UserKnownHostsFile "${hosts}"\n IdentitiesOnly yes\n`)
    runtime = { kind: 'wsl', distro: 'NewAPI-WSL', root: fixture.root }
    ssh = { kind: 'ssh', host: 'janusx-workspace-test', identityFile: join(settings.data, 'client_key'), root: fixture.root }
    const records = join(settings.data, 'janusx', 'workspaces')
    await mkdir(records, { recursive: true })
    for (const [id, environment] of [['wsl-test', runtime], ['ssh-test', ssh]] as const) {
      await writeFile(join(records, `${id}.json`), JSON.stringify({ id, name: id, path: fixture.root, runtime: environment }))
    }
  })
  afterAll(async () => {
    for (const environment of [runtime, ssh]) {
      if (!environment) continue
      await runtimeRequest(environment, 'terminal.end', { id: terminalId(environment.kind), workspaceId: environment.kind + '-test' }).catch(() => {})
    }
    disconnectRuntimeTransports()
    if (settings.data) await rm(settings.data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) // exact mkdtemp root
  })

  it('probes both channels, writes Unicode paths and detects conflicting saves', async () => {
    for (const environment of [runtime, ssh]) {
      expect(await runtimeRequest(environment, 'hello')).toMatchObject({ protocol: 3, platform: 'linux', git: true })
      const path = `${environment.kind} 100% 你好.txt`
      await runtimeRequest(environment, 'fs.save', { root: fixture.root, path, content: 'original' })
      const original = await runtimeRequest<{ content: string; version: string }>(environment, 'fs.read', { root: fixture.root, path })
      await runtimeRequest(environment, 'fs.save', { root: fixture.root, path, content: 'external' })
      expect(await runtimeRequest(environment, 'fs.save', { root: fixture.root, path, content: 'mine', expectedVersion: original.version })).toMatchObject({ conflict: true })
    }
  })

  it('runs production Git status, stage, unstage, commit, baseline and discard through SSH', async () => {
    const process = async (argv: string[]) => {
      const result = await runtimeRequest<{ exitCode: number; stderr: string }>(ssh, 'process.run', { root: fixture.root, argv })
      expect(result.exitCode, result.stderr).toBe(0)
    }
    await process(['git', 'init', '-q'])
    await process(['git', 'config', 'user.name', 'JanusX Integration'])
    await process(['git', 'config', 'user.email', 'test@example.invalid'])
    const cwd = runtimeResource('ssh-test', fixture.root)
    await stage(cwd, ['ssh 100% 你好.txt'])
    await unstage(cwd, ['ssh 100% 你好.txt'])
    expect((await getStatus(cwd)).changes.find(item => item.path === 'ssh 100% 你好.txt')?.staged).toBe(false)
    await stage(cwd, ['ssh 100% 你好.txt'])
    await commit(cwd, "test ' quote ; $ literal")
    expect(await getFileBaseline(cwd, 'ssh 100% 你好.txt')).toMatchObject({ content: 'external', tracked: true })
    await runtimeRequest(ssh, 'fs.save', { root: fixture.root, path: 'ssh 100% 你好.txt', content: 'edited\n' })
    expect((await getWorkingDiff(cwd, { maxBytes: 4096 })).content).toContain('+edited')
    await discard(cwd, 'ssh 100% 你好.txt')
    expect(await runtimeRequest(ssh, 'fs.read', { root: fixture.root, path: 'ssh 100% 你好.txt' })).toMatchObject({ content: 'external' })
  })

  it('keeps the same live PTY after every desktop transport closes on both channels', async () => {
    for (const environment of [runtime, ssh]) {
      const params = { id: terminalId(environment.kind), workspaceId: environment.kind + '-test', cwd: fixture.root,
        argv: ['python3', '-u', '-c', 'import time;print("before");time.sleep(.3);print("after-disconnect");time.sleep(60)'] }
      const first = await runtimeRequest<RuntimeTerminal>(environment, 'terminal.create', params)
      disconnectRuntimeTransports()
      await new Promise(resolve => setTimeout(resolve, 500))
      const again = await runtimeRequest<RuntimeTerminal>(environment, 'terminal.create', { ...params, attachOnly: true })
      expect(again.pid).toBe(first.pid)
      expect(again.exitCode).toBeNull()
      const output = await runtimeRequest<{ data: string }>(environment, 'terminal.poll', { ...params, after: 0 })
      expect(Buffer.from(output.data, 'base64').toString()).toContain('after-disconnect')
    }
  })

  it.each(['wsl', 'ssh'])('creates, edits and removes a sibling worktree through %s', async kind => {
    const cwd = runtimeResource(`${kind}-test`, fixture.root)
    const created = await createWorktree(cwd, { name: `linked-${kind}`, startFrom: 'HEAD' })
    expect((await listWorktrees(`${kind}-test`, cwd)).map(item => item.path)).toContain(created.worktree.path)
    const file = created.worktree.path + '/new.txt'
    expect((await remoteFileInvocation(FILE_CHANNELS.save, [file, 'remote worktree'])).handled).toBe(true)
    expect((await remoteFileInvocation(FILE_CHANNELS.read, [file])).result).toMatchObject({ content: 'remote worktree' })
    await expect(removeWorktree(cwd, created.worktree.path)).rejects.toThrow()
    expect(await removeWorktree(cwd, created.worktree.path, true)).toMatchObject({ path: created.worktree.path, branchDeleted: true })
    await expect(remoteFileInvocation(FILE_CHANNELS.save, [file, 'must not recreate'])).rejects.toThrow()
  })

  it('runs blueprint init, hash conflict and undo on Linux with both transports', async () => {
    const wslCwd = runtimeResource('wsl-test', fixture.root)
    const sshCwd = runtimeResource('ssh-test', fixture.root)
    const call = (cwd: string, method: string, ...args: unknown[]) => remoteBackendRequest<any>(cwd, method, args)
    expect(await call(wslCwd, H.workspaceStatus)).toMatchObject({ state: 'not-found' })
    const preview = await call(wslCwd, H.initPreview, 'Remote live test')
    await call(wslCwd, H.initApply, preview.id, false)
    const created = await call(sshCwd, H.apply, [{ kind: 'create', nodeType: 'epic', title: 'Remote note' }], 'test')
    const uri = created.applied[0].uri
    const note = await call(wslCwd, H.noteRead, uri)
    await call(sshCwd, H.apply, [{ kind: 'update', uri, expectedHash: note.sourceHash, patch: { title: 'Changed remotely' } }], 'test')
    await expect(call(wslCwd, H.apply, [{ kind: 'update', uri, expectedHash: note.sourceHash, patch: { title: 'Stale' } }], 'test')).rejects.toThrow(/CONFLICT/)
    await call(sshCwd, H.undoPreview)
    await call(sshCwd, H.undoApply)
    expect((await call(wslCwd, H.noteRead, uri)).raw).toContain('Remote note')
    expect((await call(sshCwd, H.projectGraph)).blueprint.nodeIds.length).toBeGreaterThan(0)
  }, 180_000)

  it('serves an SSH HTML draft and its relative assets through the existing preview server', async () => {
    await runtimeRequest(ssh, 'fs.save', { root: fixture.root, path: 'page.html', content: '<h1>disk</h1>' })
    await runtimeRequest(ssh, 'fs.save', { root: fixture.root, path: 'style.css', content: 'body{color:red}' })
    const preview = new HtmlPreviewServer()
    try {
      const lease = await preview.open(1, { workspacePath: runtimeResource('ssh-test', fixture.root), documentPath: runtimeResource('ssh-test', fixture.root + '/page.html'), content: '<h1>draft</h1>' })
      expect(await (await fetch(lease.url)).text()).toBe('<h1>draft</h1>')
      expect(await (await fetch(new URL('style.css', lease.url))).text()).toBe('body{color:red}')
      preview.releaseOwner(1)
      expect((await fetch(lease.url)).status).toBe(404)
    } finally { await preview.dispose() }
  })

  it.each(['docx', 'xlsx', 'pptx'])('renders a real remote %s using the bundled viewer and existing controls', async extension => {
    const binary = join(process.cwd(), 'resources', 'officecli', 'officecli.exe')
    officecliManager.configureBundledBinaryPath(binary)
    const local = join(settings.data, `sample.${extension}`)
    await execute(binary, ['create', local], { windowsHide: true, timeout: 15000 })
    const relPath = `中文 sample.${extension}`
    await linux('python3', '-c', 'import pathlib,sys,base64;pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(sys.argv[2]))', fixture.root + '/' + relPath, (await readFile(local)).toString('base64'))
    const scope = runtimeResource('ssh-test', fixture.root)
    const resolver = async () => scope
    const pool = new OfficeWatchPool(resolver, { onEvicted: event => releaseRemoteOfficePreviews(event.previewLeaseIds) })
    const operations = createProductionOfficeOperations({ artifactIndex: { list: async () => [] }, watchPool: pool })
    const file = await resolveTrustedOfficeFile({ workspaceId: 'ssh-test', relPath }, resolver)
    let lease: { previewLeaseId: string; port: number } | undefined
    try {
      lease = await operations.startPreview(file)
      const response = await fetch(`http://127.0.0.1:${lease.port}/`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('janus-office-controls')
    } finally {
      if (lease) await operations.stopPreview(file, { workspaceId: 'ssh-test', relPath, previewLeaseId: lease.previewLeaseId })
      await pool.stopAll()
    }
  })
})
