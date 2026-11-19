import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { execa } from 'execa'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'

// A credential-free CLI fixture exercises real npm, Electron IPC, resolver and PTY.
// The fixture owns an isolated system npm prefix, outside the JanusX profile.
test('system npm installation is shared by the external command and desktop IPC', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-cli-chain-中文-'))
  let application: ElectronApplication | undefined
  try {
    const profile = join(root, 'profile')
    const prefix = join(root, 'system-npm')
    const source = join(root, 'fixture')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'janusx-desktop-cli-fixture', version: '1.2.3', bin: { pi: 'pi.js' } }))
    await writeFile(join(source, 'pi.js'), '#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("1.2.3");process.exit(0)}\nconsole.log("CLI_CHAIN_READY");process.stdin.setEncoding("utf8");process.stdin.on("data",value=>{if(value.includes("CLI_CHAIN_INPUT"))console.log("CLI_CHAIN_REPLY")});setInterval(()=>{},1000)\n')
    const npm = join(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
    await execa(process.execPath, [npm, 'install', '-g', source, '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 60_000, windowsHide: true })
    const expected = join(prefix, process.platform === 'win32' ? 'pi.cmd' : 'bin/pi')
    const systemPath = [dirname(expected), dirname(process.execPath), process.env.PATH ?? ''].join(delimiter)
    const external = process.platform === 'win32'
      ? await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'pi --version'], { env: { ...process.env, PATH: systemPath } })
      : await execa('pi', ['--version'], { env: { ...process.env, PATH: systemPath } })
    expect(external.stdout).toBe('1.2.3')
    application = await electron.launch({
      args: [resolve(process.env.JANUSX_CLI_TEST_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${profile}`],
      env: { ...createDesktopTestEnv(root), APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'local'),
        // macOS must find the npm prefix even when the login PATH only exposes node/npm.
        PATH: process.platform === 'darwin' ? process.env.PATH : systemPath, npm_config_prefix: prefix,
        CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), PI_CODING_AGENT_DIR: join(root, 'pi'), DSH_HOME: join(root, 'dsh'),
        JANUSX_OFFICECLI_BINARY: resolve(process.env.JANUSX_OFFICECLI_BINARY ?? (process.platform === 'darwin' ? `resources/officecli/darwin-${process.arch}/officecli` : 'resources/officecli/officecli.exe')) },
    })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow()
    await page.waitForFunction(() => Boolean(window.electron?.externalCli && window.electron?.terminal))
    const probe = await page.evaluate(() => window.electron.externalCli.detect('pi'))
    expect(probe).toMatchObject({ installed: true, runnable: true, version: '1.2.3', path: expected })
    const workspace = await page.evaluate(path => window.electron.workspace.create({ name: 'CLI chain fixture', path }), source)
    const created = await page.evaluate(async ({ workspaceId, cwd }) => window.electron.terminal.create({
      id: 'cli-chain', workspaceId, cwd, shell: window.electron.platform === 'win32' ? 'powershell.exe' : '/bin/zsh', preset: 'pi', cols: 80, rows: 24,
    }), { workspaceId: workspace.id, cwd: source })
    expect(created.error).toBeUndefined()
    expect(created.pid).toBeGreaterThan(0)
    await expect.poll(async () => (await page.evaluate(() => window.electron.terminal.replay('cli-chain'))).data).toContain('CLI_CHAIN_READY')
    await page.evaluate(() => window.electron.terminal.input('cli-chain', 'CLI_CHAIN_INPUT\r'))
    await expect.poll(async () => (await page.evaluate(() => window.electron.terminal.replay('cli-chain'))).data).toContain('CLI_CHAIN_REPLY')
    await page.evaluate(() => window.electron.terminal.kill('cli-chain'))
    await expect.poll(() => {
      try { process.kill(created.pid!, 0); return true } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
        throw error
      }
    }).toBe(false)
    expect((await page.evaluate(() => window.electron.externalCli.detect('pi'))).path).toBe(expected)
  } finally {
    if (application && process.platform === 'darwin') {
      // Closing the final Mac window keeps JanusX running. Request an application quit.
      const closed = application.waitForEvent('close', { timeout: 15_000 })
      await application.evaluate(({ app }) => { setImmediate(() => app.quit()) })
      await closed
    } else {
      await application?.close()
    }
    await rm(root, { recursive: true, force: true })
  }
})
