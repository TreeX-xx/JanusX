// Note: .agents/notes/desktop/workspace-state-storage.md
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { WorkspaceAPI } from '../../src/shared/ipc/workspace'
import type { WorkspaceStorageAPI } from '../../src/shared/ipc/workspace-storage'
import type { ProjectAPI } from '../../src/shared/ipc/project'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

type Host = Window & typeof globalThis & { electron: { workspace: WorkspaceAPI; workspaceStorage: WorkspaceStorageAPI; project: ProjectAPI; system: { setLanguage(value: string): Promise<void> } } }

test('workspace migration survives a desktop crash, restarts and profile ownership checks', async () => {
  test.setTimeout(180_000)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'janusx-p6-desktop-')))
  const cwd = join(root, "project space's 中文"), profile = join(root, 'profile')
  const oldExe = process.env.JANUSX_P6_OLD_EXE
  let app: ElectronApplication | undefined
  const evidence: Array<{ stage: string; reportedVersion: string }> = []
  const entry = resolve(process.env.JANUSX_DESKTOP_ENTRY ?? 'out/main/index.js')
  const env = { ...createDesktopTestEnv(root), CLAUDE_CONFIG_DIR: join(root, '.claude'), CODEX_HOME: join(root, '.codex') }
  async function open(stage: string, executable?: string, userData = profile): Promise<Page> {
    app = await electron.launch({ ...(executable ? { executablePath: resolve(executable) } : {}),
      args: [...(executable ? [] : [entry]), `--user-data-dir=${userData}`], cwd: root, env })
    evidence.push({ stage, reportedVersion: await app.evaluate(({ app }) => app.getVersion()) })
    await seedIntroducedLearning(app.context())
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => (window as Host).electron.system.setLanguage('zh-CN'))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    return page
  }
  async function close() { await app?.close(); app = undefined }
  const list = (page: Page) => page.evaluate(() => (window as Host).electron.workspaceStorage.list())
  try {
    await mkdir(join(cwd, '.janusX', 'logs'), { recursive: true })
    await mkdir(join(cwd, '.janusX', 'checkpoints'))
    const legacy = JSON.stringify({ version: '0.1.0', projectName: 'P6 old config', projectType: 'custom', configurations: [] })
    await writeFile(join(cwd, '.janusX', 'janusX.launch.json'), legacy)
    await writeFile(join(cwd, '.janusX', 'logs', 'command.log'), 'old log')
    await writeFile(join(cwd, '.janusX', 'checkpoints', 'retired.json'), 'invalid retired snapshot')
    await writeFile(join(cwd, '.janusX', 'unknown.txt'), 'preserve me')
    await writeFile(join(cwd, 'source.ts'), 'preserve source')
    if (oldExe) {
      const oldPage = await open('old executable before upgrade', oldExe)
      await oldPage.evaluate(path => (window as Host).electron.workspace.create({ name: 'P6 upgrade', path }), cwd)
      expect(await oldPage.evaluate(path => (window as Host).electron.project.readConfig(path), cwd)).toMatchObject({ success: true, data: { projectName: 'P6 old config' } })
      await close()
    }
    let page = await open('current build before migration')
    if (!oldExe) {
      await page.evaluate(path => (window as Host).electron.workspace.create({ name: 'P6 upgrade', path }), cwd)
      await page.reload()
    }
    await expect(page.getByRole('button', { name: '前往迁移', exact: true })).toBeVisible()
    expect(await readFile(join(cwd, '.janusX', 'logs', 'command.log'), 'utf8')).toBe('old log')
    await page.getByRole('button', { name: '前往迁移', exact: true }).click()
    const panel = page.locator('#workspace-data-migration')
    await expect(panel).toBeVisible()
    await panel.locator('article').filter({ hasText: 'P6 upgrade' }).getByRole('checkbox').check()
    await panel.getByRole('button', { name: '迁移并清理旧文件', exact: true }).click()
    await expect.poll(async () => (await list(page)).items[0]?.status).toBe('migrated')
    const migrated = (await list(page)).items[0]
    const receiptPath = join(migrated.target, 'manifest.json')
    const receipt = await readFile(receiptPath, 'utf8')
    expect(await readFile(join(migrated.target, 'logs', 'command.log'), 'utf8')).toBe('old log')
    const newer = legacy.replace('P6 old config', 'P6 config after migration')
    await writeFile(join(migrated.target, 'launch.json'), newer)
    await page.screenshot({ path: 'artifacts/workspace-storage/p6-desktop-migrated.png', fullPage: true })
    // Kill the real main process after the committed migration instead of graceful shutdown.
    const process = app!.process()
    const exited = new Promise<void>(resolveExit => process.once('exit', () => resolveExit()))
    process.kill(); await exited
    await app!.close().catch(() => {}); app = undefined

    page = await open('current build after main-process kill')
    const second = spawn(app!.process().spawnfile, [entry, `--user-data-dir=${profile}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
    await new Promise<void>((resolveExit, reject) => {
      const timer = setTimeout(() => { second.kill(); reject(new Error('second process did not release the occupied profile')) }, 15_000)
      second.on('error', error => { clearTimeout(timer); reject(error) })
      second.on('exit', code => { clearTimeout(timer); if (code === 0) resolveExit(); else reject(new Error(`second process exited ${code}`)) })
    })
    expect((await list(page)).items[0]).toMatchObject({ target: migrated.target, status: 'migrated' })
    expect((await list(page)).prompt).toBe(false)
    expect(await readFile(receiptPath, 'utf8')).toBe(receipt)
    expect(await page.evaluate(path => (window as Host).electron.project.readConfig(path), cwd)).toMatchObject({ success: true, data: { projectName: 'P6 config after migration' } })
    const id = (await list(page)).items[0].id
    expect((await page.evaluate(id => (window as Host).electron.workspaceStorage.migrate([id]), id))[0].status).toBe('migrated')
    expect(await readFile(join(migrated.target, 'launch.json'), 'utf8')).toBe(newer)
    await close()
    if (oldExe) {
      page = await open('old executable after migration (downgrade boundary)', oldExe)
      // Old builds cannot see the new private directory. They must not damage it.
      expect(await page.evaluate(path => (window as Host).electron.project.readConfig(path), cwd)).toMatchObject({ success: true, data: null })
      expect(await readFile(receiptPath, 'utf8')).toBe(receipt)
      expect(await readFile(join(migrated.target, 'launch.json'), 'utf8')).toBe(newer)
      await close()
    }
    page = await open('separate profile', undefined, join(root, 'separate-profile'))
    await page.evaluate(path => (window as Host).electron.workspace.create({ name: 'P6 separate', path }), cwd)
    expect((await list(page)).items[0].target).not.toBe(migrated.target)
    expect(await readFile(receiptPath, 'utf8')).toBe(receipt)
    await close()
    page = await open('original profile on later restart')
    expect((await list(page)).items[0]).toMatchObject({ target: migrated.target, status: 'migrated' })
    expect((await list(page)).prompt).toBe(false)
    expect(await readFile(receiptPath, 'utf8')).toBe(receipt)
    expect(await readFile(join(cwd, '.janusX', 'unknown.txt'), 'utf8')).toBe('preserve me')
    expect(await readFile(join(cwd, 'source.ts'), 'utf8')).toBe('preserve source')
    const currentPackageVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version as string
    await test.info().attach('desktop-upgrade-evidence', { body: JSON.stringify({ oldExecutable: oldExe ?? null, currentEntry: entry, currentPackageVersion, evidence }), contentType: 'application/json' })
  } finally {
    await close()
    const inside = relative(await realpath(tmpdir()), root)
    if (!inside.startsWith('janusx-p6-desktop-') || inside.includes('..')) throw new Error('Unsafe P6 desktop fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
