// Opt-in Windows Electron -> actual wsl.exe / OpenSSH -> isolated Linux fixture.
// Start tests/integration/workspace-ssh-fixture.py in NewAPI-WSL first.
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

const execute = promisify(execFile)
const linux = async (...args: string[]) => (await execute('wsl.exe', ['-d', 'NewAPI-WSL', '--exec', ...args], { encoding: 'utf8', timeout: 20_000, windowsHide: true })).stdout
test.skip(process.env.JANUSX_RUNTIME_LIVE !== '1', 'Requires the explicitly enabled real WSL/SSH fixture')

test('Windows desktop imports Local/WSL/SSH, operates linked roots and reattaches after app exit', async () => {
  test.setTimeout(420_000)
  const fixture = JSON.parse(await linux('cat', '/home/newapi/.cache/janusx-workspace-test/active-fixture.json'))
  const root = await mkdtemp(join(tmpdir(), 'janusx-desktop-runtime-'))
  const local = join(root, 'local')
  const profile = join(root, 'profile')
  const key = join(root, 'client_key')
  const config = join(root, 'ssh_config')
  const hosts = join(root, 'known_hosts')
  await mkdir(local)
  await writeFile(join(local, 'local.txt'), 'Local desktop fixture')
  await writeFile(key, await linux('cat', fixture.directory + '/client_key'))
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl = New-Object System.Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($identity); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow"))); Set-Acl -LiteralPath $env:JANUSX_TEST_KEY -AclObject $acl'],
  { env: { ...process.env, JANUSX_TEST_KEY: key }, windowsHide: true })
  const hostKey = (await linux('cat', fixture.directory + '/host_key.pub')).trim().split(' ').slice(0, 2).join(' ')
  await writeFile(hosts, `[127.0.0.1]:${fixture.port} ${hostKey}\n`)
  await writeFile(config, `Host janusx-desktop-test\n HostName 127.0.0.1\n User ${fixture.user}\n Port ${fixture.port}\n IdentityFile "${key.replace(/\\/g, '/')}"\n UserKnownHostsFile "${hosts.replace(/\\/g, '/')}"\n StrictHostKeyChecking yes\n IdentitiesOnly yes\n`)
  const target = fixture.root + '/desktop-' + randomUUID().slice(0, 8)
  await linux('python3', '-c', 'import pathlib,sys,subprocess; p=pathlib.Path(sys.argv[1]); p.mkdir(); (p/"readme.md").write_text("# Remote desktop preview\\n"); subprocess.run(["git","init","-q"],cwd=p,check=True); subprocess.run(["git","config","user.name","JanusX Test"],cwd=p,check=True); subprocess.run(["git","config","user.email","test@example.invalid"],cwd=p,check=True); subprocess.run(["git","add","."],cwd=p,check=True); subprocess.run(["git","commit","-qm","fixture"],cwd=p,check=True)', target)
  const env = { ...createDesktopTestEnv(root), JANUSX_RUNTIME_LIVE: '1', JANUSX_WORKSPACE_TEST_HOME: fixture.home, JANUSX_WORKSPACE_TEST_SSH_CONFIG: config }
  let application: ElectronApplication | undefined
  let page: Page
  const launch = async () => {
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`], env })
    page = await application.firstWindow()
    await seedIntroducedLearning(page)
    await page.reload()
    await page.waitForFunction(() => Boolean((window as any).electron?.workspaceRuntime))
    return page
  }
  const sessions: Array<{ workspace: any; terminalId: string; pid: number }> = []
  try {
    await launch()
    // Native folder picker selection is deterministic; all workspace operations
    // and the production import dialog below use the built app's real IPC.
    const localWorkspace = await page!.evaluate(async path => (window as any).electron.workspace.create({ name: 'Local test', path }), local)
    expect(await page!.evaluate(async path => (window as any).electron.file.read(path), join(local, 'local.txt'))).toMatchObject({ content: 'Local desktop fixture' })
    await page!.reload()
    for (const kind of ['WSL', 'SSH']) {
      await page!.locator('button[data-onboarding="add-workspace"][aria-label]').click()
      const dialog = page!.getByRole('dialog', { name: /添加工作区|Add workspace/ })
      await dialog.getByRole('button', { name: kind, exact: true }).click()
      if (kind === 'WSL') await dialog.getByRole('combobox').selectOption('NewAPI-WSL')
      else await dialog.getByPlaceholder('user@host').fill('janusx-desktop-test')
      await dialog.getByRole('button', { name: /^(连接|Connect)$/ }).click()
      await expect.poll(async () => {
        const error = await dialog.getByRole('alert').textContent({ timeout: 150 }).catch(() => '')
        if (error) throw new Error(`${kind} connection: ${error}`)
        return dialog.getByRole('textbox', { name: /目标目录|Directory/ }).count()
      }, { timeout: 30_000 }).toBe(1)
      await dialog.getByRole('textbox', { name: /目标目录|Directory/ }).fill(target)
      await dialog.getByRole('button', { name: /添加并打开|Add and open/ }).click()
      await expect(dialog).toHaveCount(0)
      const workspace = await page!.evaluate(async kind => (await (window as any).electron.workspace.list()).find((item: any) => item.runtime?.kind === kind), kind.toLowerCase())
      expect(workspace.path).toMatch(/^janusx-workspace:\/\//)
      const result = await page!.evaluate(async ({ workspace, kind }) => {
        const api = (window as any).electron
        const tree = await api.fileTree.load(workspace.path)
        const path = workspace.path + '/readme.md'
        const before = await api.file.read(path)
        await api.file.save(path, `# ${kind} edited through Windows\n`, before.version)
        const after = await api.file.read(path)
        const status = await api.git.status(workspace.path)
        const linked = await api.worktree.create({ workspaceId: workspace.id, workspacePath: workspace.path,
          creationId: `desktop-${kind}`, name: `desktop-${kind}`, startFrom: 'HEAD' })
        await api.file.save(linked.worktree.path + '/linked.txt', 'Written in remote worktree')
        const linkedFile = await api.file.read(linked.worktree.path + '/linked.txt')
        await api.worktree.delete({ workspacePath: workspace.path, worktreePath: linked.worktree.path, force: true })
        return { tree, after, status, linkedFile }
      }, { workspace, kind })
      expect(result.tree.some((item: any) => item.name === 'readme.md')).toBe(true)
      expect(result.after.content).toContain(kind + ' edited')
      expect(result.status.isRepo).not.toBe(false)
      expect(result.linkedFile.content).toBe('Written in remote worktree')
      expect(await page!.evaluate(async workspace => (window as any).electron.window.openEditor({
        filePath: workspace.path + '/readme.md', workspacePath: workspace.path,
      }), workspace)).toMatchObject({ success: true })
      const embedded = page!.locator('[data-editor-host="embedded"]')
      await expect(embedded.locator('.preview-scroll-viewport')).toContainText(`${kind} edited through Windows`)
      await page!.screenshot({ path: test.info().outputPath(`${kind.toLowerCase()}-markdown-preview.png`) })
      await embedded.getByRole('button', { name: '更多文件操作' }).click()
      await page!.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: '返回独立浮窗' }).click()
      await expect.poll(() => application!.windows().filter(item => item.url().includes('editorWindow=1')).length).toBe(1)
      const floating = application!.windows().find(item => item.url().includes('editorWindow=1'))!
      await expect(floating.locator('.preview-scroll-viewport')).toContainText(`${kind} edited through Windows`)
      await floating.screenshot({ path: test.info().outputPath(`${kind.toLowerCase()}-floating-preview.png`) })
      await floating.getByRole('button', { name: '更多文件操作' }).click()
      await floating.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: /嵌入主/ }).click()
      await expect(embedded).toBeVisible()
      await embedded.getByRole('button', { name: /收起文件面板|Collapse file panel/ }).click()
      const terminalId = randomUUID()
      const created = await page!.evaluate(async ({ workspace, terminalId }) => (window as any).electron.terminal.create({
        id: terminalId, workspaceId: workspace.id, cwd: workspace.path, shell: '/bin/sh',
        command: 'python3', args: ['-u', '-c', 'import time;print("DESKTOP_KEEPALIVE");time.sleep(600)'],
      }), { workspace, terminalId })
      sessions.push({ workspace, terminalId, pid: created.pid })
    }
    expect(await page!.evaluate(async () => (await (window as any).electron.workspace.list()).length)).toBe(3)
    const remote = sessions[0].workspace
    const blueprint = await page!.evaluate(async cwd => {
      const h = (window as any).electron.harness
      const preview = await h.initPreview(cwd, 'Desktop remote blueprint')
      await h.initApply(cwd, preview.id, false)
      const created = await h.apply(cwd, [{ kind: 'create', nodeType: 'epic', title: 'Desktop remote note' }], 'desktop test')
      const uri = created.applied[0].uri
      const note = await h.noteRead(cwd, uri)
      await h.apply(cwd, [{ kind: 'update', uri, expectedHash: note.sourceHash, patch: { title: 'Edited via desktop' } }], 'desktop test')
      await h.undoApply(cwd)
      return { graph: await h.projectGraph(cwd), note: await h.noteRead(cwd, uri) }
    }, remote.path)
    expect(blueprint.note.raw).toContain('Desktop remote note')
    expect(blueprint.graph.blueprint.id).toContain(remote.id)
    // Real provider-store parsing with deterministic history. The CLI fixture
    // verifies native resume argv/lifecycle only, not a paid model response.
    const providerId = randomUUID()
    await linux('python3', '-c', `import pathlib,sys,json
home=pathlib.Path(sys.argv[1]); cwd=sys.argv[2]; identity=sys.argv[3]
store=home/'.claude/projects/desktop-fixture'; store.mkdir(parents=True,exist_ok=True)
rows=[dict(type='user',sessionId=identity,cwd=cwd,timestamp='2026-10-24T01:00:00Z',message=dict(role='user',content='Remote history question')),dict(type='assistant',sessionId=identity,cwd=cwd,timestamp='2026-10-24T01:00:01Z',message=dict(role='assistant',content=[dict(type='text',text='Remote history answer')]))]
(store/(identity+'.jsonl')).write_text('\\n'.join(json.dumps(row) for row in rows)+'\\n')
(home/'bin').mkdir(exist_ok=True)
cli=home/'bin/claude'; cli.write_text('#!/usr/bin/python3\\nimport sys,time,json,pathlib\\npathlib.Path.home().joinpath("resume-argv.json").write_text(json.dumps(sys.argv[1:]))\\nprint("FIXTURE_PROVIDER_RESUME",flush=True)\\ntime.sleep(180)\\n'); cli.chmod(0o700)
(home/'.profile').write_text('export PATH="$HOME/bin:$PATH"\\n')`, fixture.home, target, providerId)
    const imported = await page!.evaluate(async () => {
      const api = (window as any).electron
      const scan = await api.session.scanExternal()
      return { scan, records: await api.session.list() }
    })
    expect(imported.scan.remote.errors).toEqual([])
    const histories = imported.records.filter((record: any) => record.providerSessionId === providerId)
    expect(histories).toHaveLength(2)
    expect(new Set(histories.map((record: any) => record.workspaceId)).size).toBe(2)
    for (const source of histories) {
      expect(await page!.evaluate(async id => (window as any).electron.session.getTranscript(id), source.id)).toMatchObject({ turns: [{ prompt: 'Remote history question', excerpt: 'Remote history answer' }] })
      const resumed = await page!.evaluate(async id => (window as any).electron.session.continue({ sessionId: id, mode: 'resume' }), source.id)
      const running = await page!.evaluate(async id => (window as any).electron.workspaceRuntime.terminals(id), source.workspaceId)
      const terminal = running.find((entry: any) => entry.id === resumed.terminalId)
      expect(terminal.argv.slice(-2)).toEqual(['--resume', providerId])
      sessions.push({ workspace: sessions.find(item => item.workspace.id === source.workspaceId)!.workspace,
        terminalId: resumed.terminalId, pid: terminal.pid })
    }
    await page!.screenshot({ path: test.info().outputPath('windows-mixed-workspaces.png') })
    await application!.close()
    application = undefined
    await launch()
    for (const item of sessions) {
      // Check automatic startup attachment before issuing an explicit attach.
      await expect.poll(async () => (await page!.evaluate(async id => (window as any).electron.terminal.replay(id), item.terminalId)).data,
        { timeout: 20_000 }).toMatch(/DESKTOP_KEEPALIVE|FIXTURE_PROVIDER_RESUME/)
      const restored = await page!.evaluate(async ({ workspace, terminalId }) => {
        const api = (window as any).electron
        const list = await api.workspaceRuntime.terminals(workspace.id)
        const process = list.find((entry: any) => entry.id === terminalId)
        const attached = await api.terminal.create({ id: terminalId, workspaceId: workspace.id, cwd: workspace.path, shell: '/bin/sh', attachOnly: true })
        return { process, attached }
      }, item)
      expect(restored.process.exitCode).toBeNull()
      expect(restored.attached.pid).toBe(item.pid)
    }
    expect((await page!.evaluate(async id => (window as any).electron.workspace.load(id), localWorkspace.id)).path).toBe(local)
    await page!.locator('[data-runtime-kind="ssh"]').click()
    await expect(page!.locator('.xterm-screen:visible').first()).toBeVisible()
    await page!.screenshot({ path: test.info().outputPath('windows-remote-reattached.png') })
  } catch (error) {
    if (page! && !page!.isClosed()) {
      await page!.screenshot({ path: test.info().outputPath('failure.png') }).catch(() => {})
      console.log((await page!.locator('body').innerText()).slice(-4500))
    }
    throw error
  } finally {
    if (application) {
      for (const item of sessions) await page!.evaluate(async id => (window as any).electron.terminal.kill(id), item.terminalId).catch(() => {})
      await application.close()
    }
    // Keep this exact isolated profile for inspecting failed UI runs; never
    // delete another test's temp directory or mutate the user's SSH settings.
    await test.info().attach('fixture-paths', { body: JSON.stringify({ root, target }), contentType: 'application/json' })
  }
})
