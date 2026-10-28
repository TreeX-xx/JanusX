import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { ProjectAPI } from '../../src/shared/ipc/project'
import type { TerminalAPI } from '../../src/shared/ipc/terminal'
import type { WorkspaceAPI } from '../../src/shared/ipc/workspace'
import { createDesktopTestEnv, seedIntroducedLearning } from './desktop-test-env'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import type { BrowserAPI } from '../../src/shared/ipc/browser'

interface DesktopAPI {
  browser: BrowserAPI
  system: { setLanguage(language: string): Promise<void> }
  project: ProjectAPI
  terminal: TerminalAPI
  workspace: WorkspaceAPI
}

type DesktopWindow = Window & { electron: DesktopAPI }
type ElectronProcess = ReturnType<ElectronApplication['process']>

const PROCESS_EXIT_TIMEOUT = 5_000

for (const theme of ['dark', 'planche']) {
  test(`startup theme ${theme} matches the persisted profile from the native background onward`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-startup-theme-'))
    let application: ElectronApplication | undefined
    try {
      const userDataDir = join(root, 'profile')
      await mkdir(join(userDataDir, 'janusx'), { recursive: true })
      await writeFile(join(userDataDir, 'janusx', 'config.json'), JSON.stringify({ theme, themeMigratedToSlate: true }))
      application = await electron.launch({
        args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDir}`],
        env: createDesktopTestEnv(root),
      })
      const page = await application.firstWindow()
      const background = theme === 'dark' ? '#151517' : '#EFE4C5'
      expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())).toBe(background)
      await page.waitForLoadState('domcontentloaded')
      expect(new URL(page.url()).searchParams.get('initialTheme')).toBe(theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('#root')).not.toBeEmpty()

      // Replay navigation with instrumentation installed before the HTML script,
      // sampling every frame, including the empty page before React mounts.
      await page.addInitScript(() => {
        const frames: Array<{ theme: string | undefined; background: string }> = []
        ;(window as any).startupFrames = frames
        const sample = () => {
          frames.push({ theme: document.documentElement.dataset.theme, background: getComputedStyle(document.documentElement).backgroundColor })
          if (frames.length < 30) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await page.reload()
      await expect(page.locator('#root')).not.toBeEmpty()
      await expect.poll(() => page.evaluate(() => (window as any).startupFrames.length)).toBeGreaterThan(5)
      const frames = await page.evaluate(() => (window as any).startupFrames as Array<{ theme: string; background: string }>)
      expect(frames.every(frame => frame.theme === theme)).toBe(true)
      const rgb = theme === 'dark' ? 'rgb(21, 21, 23)' : 'rgb(239, 228, 197)'
      expect(frames.every(frame => frame.background === rgb)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`startup-${theme}.png`) })
    } finally {
      await closeApplication(application)
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
}

async function cleanupRendererFixtures(
  page: Page | undefined,
  terminalId: string | undefined,
  workspaceId: string | undefined,
): Promise<void> {
  if (!page || page.isClosed()) return
  await page.evaluate(
    async ({ terminalId, workspaceId }) => {
      const api = (window as DesktopWindow).electron
      if (terminalId) await api.terminal.kill(terminalId).catch(() => undefined)
      if (workspaceId) await api.workspace.delete(workspaceId).catch(() => undefined)
    },
    { terminalId, workspaceId },
  ).catch(() => undefined)
}

async function closeApplication(application: ElectronApplication | undefined): Promise<void> {
  if (!application) return
  const process = application.process()
  if (!isProcessRunning(process)) return

  const closedGracefully = await settlesWithin(application.close(), PROCESS_EXIT_TIMEOUT)
  if (closedGracefully || !isProcessRunning(process)) return

  process.kill('SIGKILL')
  if (!(await waitForProcessExit(process, PROCESS_EXIT_TIMEOUT))) {
    throw new Error('Electron process did not exit after forced termination')
  }
}

function isProcessRunning(process: ElectronProcess): boolean {
  return process.exitCode === null && process.signalCode === null
}

async function settlesWithin(promise: Promise<unknown>, timeout: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise.then(() => true, () => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForProcessExit(process: ElectronProcess, timeout: number): Promise<boolean> {
  if (!isProcessRunning(process)) return true
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined
    const finish = (exited: boolean): void => {
      if (timer) clearTimeout(timer)
      process.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    process.once('exit', onExit)
    timer = setTimeout(() => finish(false), timeout)
    if (!isProcessRunning(process)) finish(true)
  })
}

test('built desktop exposes typed Workspace, Terminal, and Project critical paths', async () => {
  const entry = resolve('out/main/index.js')
  let fixtureRoot: string | undefined
  let application: ElectronApplication | undefined
  let page: Page | undefined
  let workspaceId: string | undefined
  let terminalId: string | undefined

  try {
    await access(entry)
    fixtureRoot = await mkdtemp(join(tmpdir(), 'janusx-desktop-smoke-'))
    const userDataDir = join(fixtureRoot, 'user-data')
    const workspacePath = join(fixtureRoot, 'workspace')
    const secondWorkspacePath = join(fixtureRoot, 'workspace-two')
    const projectPath = join(fixtureRoot, 'vite-project')
    await Promise.all([
      mkdir(userDataDir, { recursive: true }),
      mkdir(workspacePath, { recursive: true }),
      mkdir(secondWorkspacePath, { recursive: true }),
      mkdir(join(projectPath, 'src'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(workspacePath, 'dock-file.txt'), 'dock fixture\n'),
      writeFile(
        join(projectPath, 'package.json'),
        JSON.stringify({ name: 'desktop-smoke-vite', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } }),
      ),
      writeFile(join(projectPath, 'vite.config.ts'), 'export default {}\n'),
    ])
    execFileSync('git', ['init', '-b', 'main'], { cwd: workspacePath })
    execFileSync('git', ['-c', 'user.name=Desktop Test', '-c', 'user.email=desktop-test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: workspacePath })

    application = await electron.launch({
      args: [entry, `--user-data-dir=${userDataDir}`],
      env: {
        ...createDesktopTestEnv(fixtureRoot),
      },
    })
    page = await application.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => {
      const api = (window as DesktopWindow).electron
      return Boolean(api?.workspace?.create && api?.terminal?.create && api?.project?.detect)
    })
    await expect(page.locator('body')).toBeVisible()
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('zh-CN'))

    const workspace = await page.evaluate(
      ({ workspacePath }) =>
        (window as DesktopWindow).electron.workspace.create({
          name: 'Desktop smoke workspace',
          path: workspacePath,
        }),
      { workspacePath },
    )
    workspaceId = workspace.id
    expect(workspace).toMatchObject({
      id: expect.any(String),
      name: 'Desktop smoke workspace',
      path: workspacePath,
      clis: [],
      layout: { mode: 'grid', positions: [] },
    })

    const secondWorkspace = await page.evaluate(
      ({ workspacePath }) =>
        (window as DesktopWindow).electron.workspace.create({
          name: 'Desktop smoke workspace two',
          path: workspacePath,
        }),
      { workspacePath: secondWorkspacePath },
    )

    const listed = await page.evaluate(() => (window as DesktopWindow).electron.workspace.list())
    expect(listed).toContainEqual(workspace)
    expect(listed).toContainEqual(secondWorkspace)
    const loaded = await page.evaluate(
      (id) => (window as DesktopWindow).electron.workspace.load(id),
      workspace.id,
    )
    expect(loaded).toEqual(workspace)

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    // 团队登录挡板仅在 teamCollab 实验开关开启时自动弹出（默认关闭）；
    // 开关关闭时工作区行直接可见，无需跳过。
    const skipGate = page.getByRole('button', { name: '稍后再说，先用本地功能' })
    await skipGate.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
    if (await skipGate.count()) await skipGate.click()

    const workspaceRow = page.locator('.ws').filter({ hasText: 'Desktop smoke workspace' }).first()
    await expect(workspaceRow).toBeVisible()
    const sidebarHeader = page.locator('[data-workspace-sidebar-header]')
    await expect(sidebarHeader).toHaveCSS('border-bottom-width', '0px')
    await expect(sidebarHeader).toHaveCSS('height', '40px')
    await page.screenshot({ path: test.info().outputPath('sidebar-heading.png') })
    const secondWorkspaceRow = page.locator('.ws').filter({ hasText: 'Desktop smoke workspace two' }).first()
    await expect(secondWorkspaceRow).toBeVisible()
    const secondWorkspaceRowBox = await secondWorkspaceRow.boundingBox()
    const workspaceRowBox = await workspaceRow.boundingBox()
    if (!workspaceRowBox || !secondWorkspaceRowBox) throw new Error('Workspace rows have no layout box')
    await page.mouse.move(secondWorkspaceRowBox.x + secondWorkspaceRowBox.width / 2, secondWorkspaceRowBox.y + secondWorkspaceRowBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(secondWorkspaceRowBox.x + secondWorkspaceRowBox.width / 2, secondWorkspaceRowBox.y + 4)
    await page.mouse.move(workspaceRowBox.x + workspaceRowBox.width / 2, workspaceRowBox.y + workspaceRowBox.height / 2, { steps: 6 })
    await page.waitForTimeout(360)
    await page.mouse.up()
    const groupNameInput = page.getByRole('textbox', { name: '分组名称' })
    await expect(groupNameInput).toBeVisible()
    await groupNameInput.fill('Desktop smoke group')
    await groupNameInput.press('Enter')
    await expect(page.getByText('Desktop smoke group', { exact: true })).toBeVisible()
    await expect.poll(async () => page.evaluate(async ({ firstId, secondId }) => {
      const workspaces = await (window as DesktopWindow).electron.workspace.list()
      const first = workspaces.find((item) => item.id === firstId)
      const second = workspaces.find((item) => item.id === secondId)
      return {
        sameGroup: Boolean(first?.sidebarGroup?.id && first.sidebarGroup.id === second?.sidebarGroup?.id),
        groupName: first?.sidebarGroup?.name,
      }
    }, { firstId: workspace.id, secondId: secondWorkspace.id })).toEqual({
      sameGroup: true,
      groupName: 'Desktop smoke group',
    })

    // Note: the row's ⋯ button is hover-revealed, so the row must be hovered before it has a hit box — see .agents/notes/sessions/workspace-row-hover-reveal.md
    await secondWorkspaceRow.hover()
    await secondWorkspaceRow.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '移出分组', exact: true }).click()
    await expect(page.getByText('Desktop smoke group', { exact: true })).toHaveCount(0)
    await expect.poll(async () => page.evaluate(async ({ firstId, secondId }) => {
      const workspaces = await (window as DesktopWindow).electron.workspace.list()
      return workspaces
        .filter((item) => item.id === firstId || item.id === secondId)
        .every((item) => !item.sidebarGroup)
    }, { firstId: workspace.id, secondId: secondWorkspace.id })).toBe(true)
    await secondWorkspaceRow.click()
    await expect(secondWorkspaceRow).toHaveAttribute('aria-current', 'true')
    await workspaceRow.click()
    await expect(workspaceRow).toHaveAttribute('aria-current', 'true')
    await expect(page.evaluate(
      (id) => (window as DesktopWindow).electron.workspace.delete(id),
      secondWorkspace.id,
    )).resolves.toEqual({ success: true })

    await page.mouse.move(workspaceRowBox.x + workspaceRowBox.width / 2, workspaceRowBox.y + workspaceRowBox.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()
    const launchModal = page.locator('.ws-config-modal')
    await expect(launchModal).toHaveCount(0)
    await workspaceRow.hover()
    await workspaceRow.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('button', { name: '运行配置…', exact: true }).click()
    await expect(launchModal).toBeVisible()
    await expect(launchModal.getByRole('button', { name: /分析/ })).toHaveCount(1)
    await expect(launchModal.getByRole('button', { name: '分析', exact: true })).toBeVisible()
    await expect(launchModal.getByRole('button', { name: '测试', exact: true })).toBeVisible()
    await expect(launchModal.getByRole('button', { name: '启动', exact: true })).toBeVisible()
    await expect(launchModal.locator('textarea[placeholder*="生成"]')).toBeVisible()
    const modalBox = await launchModal.boundingBox()
    expect(modalBox?.width).toBeGreaterThan(900)
    expect(modalBox?.height).toBeLessThanOrEqual(760)
    await page.screenshot({ path: test.info().outputPath('workspace-launch-window.png') })
    await launchModal.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(launchModal).toHaveCount(0)

    const dock = page.locator('[aria-label="右侧工具 Dock"]')
    const rail = page.getByRole('toolbar', { name: '右侧工具' })
    const panelShell = page.getByTestId('right-tool-panel-shell')
    const expectPanelClosed = async () => {
      await page.mouse.move(0, 0)
      await expect(panelShell).toHaveAttribute('aria-hidden', 'true')
      await expect(panelShell).toHaveAttribute('inert', '')
      await expect(panelShell).toHaveCSS('opacity', '0')
    }
    await expect(dock).toBeVisible()
    await expect(rail).toBeVisible()
    expect((await rail.boundingBox())?.width).toBe(48)
    expect((await page.getByRole('main').boundingBox())?.width).toBeGreaterThanOrEqual(320)

    const filesRailButton = page.getByRole('button', { name: /打开文件工具/ })
    if (
      !(await filesRailButton.getAttribute('aria-label'))?.includes('当前') ||
      await panelShell.getAttribute('data-visible') === 'false'
    ) {
      await filesRailButton.click()
    }
    await expect(filesRailButton).toHaveAttribute('aria-label', /当前/)
    await expect(panelShell).toBeVisible()
    const filesPanel = page.locator('#right-tool-panel-files')
    const fileExplorerContent = filesPanel.getByTestId('file-explorer-content')
    await expect(filesPanel).toHaveAttribute('aria-hidden', 'false')
    await expect(fileExplorerContent).toBeVisible()
    const originalFilesPanel = await filesPanel.elementHandle()
    await filesRailButton.click()
    await expectPanelClosed()
    expect(await originalFilesPanel?.evaluate((element) => element.isConnected)).toBe(true)
    await filesRailButton.click()
    await expect(panelShell).toBeVisible()

    await fileExplorerContent.click({ button: 'right', position: { x: 16, y: 16 } })
    await expect(page.getByRole('button', { name: '新建文件', exact: true })).toBeVisible()
    await filesRailButton.click()
    await expectPanelClosed()
    await expect(page.getByRole('button', { name: '新建文件', exact: true })).toHaveCount(0)
    expect(await originalFilesPanel?.evaluate((element) => element.isConnected)).toBe(true)
    await filesRailButton.click()
    await expect(panelShell).toBeVisible()

    await expect(filesPanel).toHaveAttribute('aria-hidden', 'false')
    await expect(fileExplorerContent).toBeVisible()
    await fileExplorerContent.click({ button: 'right', position: { x: 16, y: 16 } })
    await expect(page.getByRole('button', { name: '新建文件', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /打开 Git 工具/ }).click()
    await expect(page.getByRole('button', { name: '新建文件', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Push', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /打开文件工具/ }).evaluate((element: HTMLElement) => element.click())
    await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0)

    await filesRailButton.click()
    expect(await originalFilesPanel?.evaluate((element) => element.isConnected)).toBe(true)
    await expectPanelClosed()
    await expect(rail).toBeVisible()
    await filesRailButton.click()
    await expect(panelShell).toBeVisible()

    const separator = page.getByRole('separator', { name: '调整右侧工具面板宽度' })
    await separator.focus()
    await separator.press('Home')
    await expect(separator).toHaveAttribute('aria-valuenow', '240')
    await separator.press('End')
    const maximumWidth = Number(await separator.getAttribute('aria-valuemax'))
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBe(maximumWidth)
    const separatorBox = await separator.boundingBox()
    if (!separatorBox) throw new Error('Right Dock separator has no layout box')
    await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + 40)
    await page.mouse.down()
    await page.mouse.move(separatorBox.x - 24, separatorBox.y + 40)
    await page.mouse.up()
    expect(await page.evaluate(() => ({ cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }))).toEqual({ cursor: '', userSelect: '' })

    await page.setViewportSize({ width: 680, height: 800 })
    await expectPanelClosed()
    await expect(rail).toBeVisible()
    await page.getByRole('button', { name: /打开文件工具，当前/ }).click()
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(panelShell).toBeVisible()
    expect((await page.getByRole('main').boundingBox())?.width).toBeGreaterThanOrEqual(320)

    const fileRow = filesPanel.locator('[data-file-path="dock-file.txt"]')
    await expect(fileRow).toBeVisible()
    await fileRow.dblclick()
    const embeddedEditor = page.getByRole('region', { name: 'Embedded file editor' })
    await expect(embeddedEditor).toBeVisible()
    const initialEditorWindowPromise = application.waitForEvent('window')
    await embeddedEditor.getByRole('button', { name: '更多文件操作' }).click()
    await page.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: '返回独立浮窗' }).click()
    const initialEditorWindow = await initialEditorWindowPromise
    await initialEditorWindow.waitForLoadState('domcontentloaded')
    await initialEditorWindow.getByRole('button', { name: '更多文件操作' }).click()
    const initialPinButton = initialEditorWindow.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: '锁定窗口置顶' })
    await expect(initialPinButton).toBeVisible()
    await initialPinButton.click()
    await initialEditorWindow.getByRole('button', { name: '更多文件操作' }).click()
    await expect(initialEditorWindow.getByRole('button', { name: '取消窗口置顶' })).toHaveAttribute('aria-pressed', 'true')
    await initialEditorWindow.getByRole('button', { name: '嵌入主窗口工作区' }).click()

    await expect(embeddedEditor).toBeVisible()
    await expectPanelClosed()
    expect((await page.getByRole('main').boundingBox())?.width).toBeGreaterThanOrEqual(320)
    const editorSeparator = page.getByRole('separator', { name: 'Resize embedded editor' })
    await editorSeparator.focus()
    await editorSeparator.press('Home')
    await expect(editorSeparator).toHaveAttribute('aria-valuenow', '360')
    await page.screenshot({ path: test.info().outputPath('embedded-file-editor.png') })

    const restoredEditorWindowPromise = application.waitForEvent('window')
    await embeddedEditor.getByRole('button', { name: '更多文件操作' }).click()
    await page.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: '返回独立浮窗' }).click()
    const restoredEditorWindow = await restoredEditorWindowPromise
    await restoredEditorWindow.waitForLoadState('domcontentloaded')
    await restoredEditorWindow.getByRole('button', { name: '更多文件操作' }).click()
    await expect(restoredEditorWindow.getByRole('button', { name: '锁定窗口置顶' })).toBeVisible()
    await restoredEditorWindow.getByRole('button', { name: '嵌入主窗口工作区' }).click()

    await expect(embeddedEditor).toBeVisible()
    await embeddedEditor.getByRole('button', { name: '收起文件面板', exact: true }).click()
    await expect(embeddedEditor).toHaveCount(0)
    await expect(panelShell).toBeVisible()

    await page.getByRole('button', { name: '收起工作区侧栏', exact: true }).click()
    await expect(rail).toBeVisible()
    expect((await page.getByRole('main').boundingBox())?.width).toBeGreaterThanOrEqual(320)
    await page.getByRole('main').getByRole('button', { name: 'PowerShell', exact: true }).click()
    const terminalInput = page.locator('.xterm-helper-textarea').first()
    await expect(terminalInput).toBeAttached({ timeout: 15_000 })
    const terminalScreen = page.locator('.xterm-screen').first()
    await expect(terminalScreen).toBeVisible()
    const terminalBox = await terminalScreen.boundingBox()
    const centerBox = await page.getByRole('main').boundingBox()
    expect(terminalBox?.width).toBeGreaterThan(0)
    expect(terminalBox?.width).toBeLessThanOrEqual(centerBox?.width ?? 0)
    // Note: wait for the shell, not only xterm's DOM — see .agents/notes/2026-09-20-reproducible-verification.md
    await expect(page.locator('.xterm-rows').first()).toContainText(/[>$#]\s*$/, { timeout: 30_000 })
    await terminalInput.focus()
    await terminalInput.pressSequentially('echo JANUSX_DOCK_FIT')
    await terminalInput.press('Enter')
    await expect(page.locator('.xterm-rows')).toContainText('JANUSX_DOCK_FIT', { timeout: 10_000 })
    await page.screenshot({ path: test.info().outputPath('continuous-workspace.png') })

    const terminalTabs = page.locator('main [data-tab-id^="terminal:"]')
    await expect(terminalTabs).toHaveCount(1)
    const firstTerminalView = terminalScreen.locator('xpath=ancestor::*[@aria-hidden][1]')
    const firstTerminalElement = await terminalScreen.elementHandle()
    if (!firstTerminalElement) throw new Error('First terminal did not expose an xterm screen')

    await page.getByRole('main').getByRole('button', { name: 'New Terminal', exact: true }).click()
    // 新建终端菜单列出用户自建 shell 条目；全新 profile 的种子项是 PowerShell
    // （见 .agents/notes/terminal/shell-profiles.md 的 Decisions）。
    await page.getByRole('menuitem', { name: 'New PowerShell terminal', exact: true }).click()
    await expect(terminalTabs).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('.xterm-screen')).toHaveCount(2, { timeout: 15_000 })
    await page.screenshot({ path: test.info().outputPath('rounded-workspace-tabs.png') })
    await expect(firstTerminalView).toHaveAttribute('aria-hidden', 'true')
    expect(await firstTerminalElement.evaluate((element) => element.isConnected)).toBe(true)

    const secondTerminalInput = page.locator('.xterm-helper-textarea').nth(1)
    const secondTerminalScreen = page.locator('.xterm-screen').nth(1)
    await expect(secondTerminalScreen).toBeVisible()
    await expect(page.locator('.xterm-rows').nth(1)).toContainText(/[>$#]\s*$/, { timeout: 30_000 })
    await secondTerminalInput.focus()
    await secondTerminalInput.pressSequentially('echo JANUSX_SECOND_TAB')
    await secondTerminalInput.press('Enter')
    await expect(page.locator('.xterm-rows').nth(1)).toContainText('JANUSX_SECOND_TAB', { timeout: 10_000 })

    await terminalTabs.first().click()
    await expect(firstTerminalView).toHaveAttribute('aria-hidden', 'false')
    await expect(terminalScreen).toBeVisible()
    await expect(secondTerminalScreen).toBeHidden()
    expect(await firstTerminalElement.evaluate((element) => element.isConnected)).toBe(true)
    const recoveredTerminalBox = await terminalScreen.boundingBox()
    expect(recoveredTerminalBox?.width).toBeGreaterThan(0)
    expect(recoveredTerminalBox?.height).toBeGreaterThan(0)
    await expect(page.locator('.xterm-rows').first()).toContainText('JANUSX_DOCK_FIT')
    await terminalInput.focus()
    await terminalInput.pressSequentially('echo JANUSX_TAB_RECOVERED')
    await terminalInput.press('Enter')
    await expect(page.locator('.xterm-rows').first()).toContainText('JANUSX_TAB_RECOVERED', { timeout: 10_000 })

    const shell = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL ?? '/bin/sh'
    terminalId = `desktop-smoke-${process.pid}`
    await expect(
      page.evaluate(() => (window as DesktopWindow).electron.terminal.warmup({ engines: [] })),
    ).resolves.toEqual({ ok: true })
    const createdTerminal = await page.evaluate(
      ({ cwd, id, shell, workspaceId }) =>
        (window as DesktopWindow).electron.terminal.create({
          id,
          workspaceId,
          cwd,
          shell,
          preset: 'shell',
          cols: 80,
          rows: 24,
        }),
      { cwd: workspacePath, id: terminalId, shell, workspaceId: workspace.id },
    )
    expect(createdTerminal.pid).toBeGreaterThan(0)
    const replay = await page.evaluate(
      (id) => (window as DesktopWindow).electron.terminal.replay(id),
      terminalId,
    )
    expect(replay).toEqual({ data: expect.any(String), seq: expect.any(Number) })
    await expect(
      page.evaluate(
        (id) => (window as DesktopWindow).electron.terminal.kill(id),
        terminalId,
      ),
    ).resolves.toEqual({ success: true })
    terminalId = undefined

    const detected = await page.evaluate(
      (path) => (window as DesktopWindow).electron.project.detect(path),
      projectPath,
    )
    expect(detected).toEqual({ success: true, data: { type: 'vite' } })
    const details = await page.evaluate(
      (path) => (window as DesktopWindow).electron.project.detectWithDetails(path),
      projectPath,
    )
    expect(details).toMatchObject({
      success: true,
      data: {
        type: 'vite',
        confidence: expect.any(Number),
        detectedFeatures: ['package.json', 'vite.config.ts'],
        recommendedConfig: { type: 'vite', packageManager: 'npm' },
      },
    })

    await expect(
      page.evaluate(
        (id) => (window as DesktopWindow).electron.workspace.delete(id),
        workspace.id,
      ),
    ).resolves.toEqual({ success: true })
    workspaceId = undefined
    const afterDelete = await page.evaluate(() => (window as DesktopWindow).electron.workspace.list())
    expect(afterDelete.some((item) => item.id === workspace.id)).toBe(false)
  } finally {
    await cleanupRendererFixtures(page, terminalId, workspaceId)
    await closeApplication(application)
    if (fixtureRoot) {
      await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
})

test('Browser start page stays visible in an independent window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'janusx-browser-start-'))
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'user-data')}`],
      env: createDesktopTestEnv(root),
    })
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('en'))
    await seedIntroducedLearning(page)
    await page.reload()
    await page.locator('button[data-id="tool-menu"]').click()
    await page.locator('button[data-id="browser"]').click()
    await expect(page.locator('[data-browser-start-page]')).toBeVisible()
    const [standalone] = await Promise.all([
      application.waitForEvent('window'),
      page.getByRole('button', { name: 'Pop out to standalone window', exact: true }).click(),
    ])
    await standalone.waitForLoadState('domcontentloaded')
    await expect(standalone.locator('[data-browser-start-page]')).toBeVisible()
    await expect(standalone.getByRole('button', { name: 'Close tab, hold to confirm', exact: true })).toBeInViewport()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.contentView.children.length),
    )).toEqual([0, 0])
    await standalone.getByRole('button', { name: 'Enter a URL', exact: true }).click()
    await expect(standalone.getByRole('textbox', { name: 'Address bar', exact: true })).toBeFocused()
    await standalone.screenshot({ path: test.info().outputPath('browser-standalone-start.png') })
  } finally {
    await closeApplication(application)
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('Browser load failure, retry, dialogs and close release native browser views', async () => {
  const entry = resolve(process.env.JANUSX_E2E_ENTRY || 'out/main/index.js')
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'janusx-browser-smoke-'))
  let application: ElectronApplication | undefined
  let applicationClosed = false
  let failRequests = true
  const server = createServer((_request, response) => {
    if (failRequests) {
      response.destroy()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Browser fixture</title><h1>Workspace browser</h1>')
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    application = await electron.launch({
      args: [entry, `--user-data-dir=${join(fixtureRoot, 'user-data')}`],
      env: createDesktopTestEnv(fixtureRoot),
    })
    application.on('close', () => { applicationClosed = true })
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(async () => {
      const api = (window as DesktopWindow).electron
      await api.system.setLanguage('en')
    })
    await seedIntroducedLearning(page)
    await page.reload()

    const nativeViews = () => application!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.map((view) => ({ bounds: view.getBounds() })),
    )
    // 工作区浏览器入口收在顶栏工具菜单里（展开 → 选浏览器），每次开的是一个新 surface
    // （id 由渲染层随机生成），且开着时菜单条目置灰，所以"重新打开失败页"=
    // 关掉标签 → 再从菜单点入口 → 重新导航到 fixture 地址。
    const toolTrigger = page.locator('button[data-id="tool-menu"]')
    const browserItem = page.locator('button[data-id="browser"]')
    const expectBrowserEntryAvailable = async () => {
      await expect(toolTrigger).toBeEnabled()
      await toolTrigger.click()
      await expect(browserItem).toBeEnabled()
      // 断言完收起菜单，让"入口恢复可点"与后续"再打开"各测各的，也避免二次点击把菜单切回去。
      await page.keyboard.press('Escape')
      await expect(toolTrigger).toHaveAttribute('aria-expanded', 'false')
    }
    const addressBar = page.getByRole('textbox', { name: 'Address bar' })
    const openFixturePage = async () => {
      await expectBrowserEntryAvailable()
      await toolTrigger.click()
      await browserItem.click()
      await expect(page.locator('[data-browser-start-page]')).toBeVisible()
      await expect.poll(nativeViews).toHaveLength(0)
      await page.getByRole('button', { name: 'Enter a URL', exact: true }).click()
      await expect(addressBar).toBeFocused()
      await addressBar.fill(url)
      await addressBar.press('Enter')
      const tabId = await page.locator('[data-tab-id]').first().getAttribute('data-tab-id')
      expect(tabId).toMatch(/^browser:/)
      return tabId!.slice('browser:'.length)
    }
    const surfaceId = await openFixturePage()
    const error = page.getByRole('alert').filter({ hasText: 'ERR_EMPTY_RESPONSE' })
    await expect(error).toBeVisible()
    await expect(error).toContainText(url)
    await expect(addressBar).toHaveValue(url)
    await expect.poll(nativeViews).toHaveLength(0)

    await page.locator('[data-tab-id]').first().hover()
    await page.locator('[data-tab-close="true"]').click({ delay: 1100 })
    await expect(error).toHaveCount(0)
    await expectBrowserEntryAvailable()
    expect(await page.evaluate((id) => (window as DesktopWindow).electron.browser.getState(id), surfaceId)).toBeNull()
    await openFixturePage()
    await expect(error).toBeVisible()

    failRequests = false
    await error.getByRole('button', { name: 'Retry' }).click()
    await expect(error).toHaveCount(0)
    await expect.poll(nativeViews).toHaveLength(1)
    await expect.poll(() => application!.evaluate(({ webContents }) =>
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Browser fixture'),
    )).toBe(true)

    // Blank tabs must detach the native page, then restore it on activation.
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await expect(page.locator('[data-browser-start-page]')).toBeVisible()
    await expect(addressBar).toHaveValue('')
    await expect.poll(nativeViews).toHaveLength(0)
    await page.getByRole('tab', { name: 'Browser fixture', exact: true }).click()
    await expect(page.locator('[data-browser-start-page]')).toHaveCount(0)
    await expect.poll(nativeViews).toHaveLength(1)

    // A DOM visibility assertion alone cannot detect a WebContentsView covering a dialog.
    // Check Electron's native child tree as well, then click the real cancel button.
    const closeButton = page.locator('[data-window-action="close"]')
    await closeButton.click()
    const confirmation = page.getByRole('dialog', { name: 'Confirm close', exact: true })
    await expect(confirmation).toBeVisible()
    await expect.poll(nativeViews).toHaveLength(0)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect.poll(nativeViews).toHaveLength(1)

    await page.getByTitle('Settings', { exact: true }).click()
    await expect(page.locator('.modal-frame-panel')).toBeVisible()
    await expect.poll(nativeViews).toHaveLength(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-frame-panel')).toHaveCount(0)
    await expect.poll(nativeViews).toHaveLength(1)

    await page.locator('[data-tab-id]').first().hover()
    await page.locator('[data-tab-close="true"]').click({ delay: 1100 })
    await expect.poll(nativeViews).toHaveLength(0)
    await expectBrowserEntryAvailable()
    expect(await page.evaluate((id) => (window as DesktopWindow).electron.browser.getState(id), surfaceId)).toBeNull()

    // Reopen and quit with a live page: the Quit button must remain clickable.
    await openFixturePage()
    await expect.poll(nativeViews).toHaveLength(1)
    await closeButton.click()
    await expect.poll(nativeViews).toHaveLength(0)
    await Promise.all([
      application.waitForEvent('close'),
      confirmation.getByRole('button', { name: 'Quit', exact: true }).click(),
    ])
  } finally {
    if (application && !applicationClosed) await application.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
