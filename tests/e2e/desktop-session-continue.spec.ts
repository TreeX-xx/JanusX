// Note: Continue in New Session live drill — one Continue mints exactly one
// card, the focused handoff lands once the composer is ready, a failed create
// leaves no ghost, and external rows run provider resume — see
// .agents/notes/sessions/records/session-identity-single-mint.md and
// .agents/notes/sessions/requirements/workspace-session-checkpoint-continue.md
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ExperimentalAPI } from '../../src/shared/ipc/experimental'
import type { SessionAPI, AgentSessionSummary } from '../../src/shared/ipc/session'
import type { TerminalAPI } from '../../src/shared/ipc/terminal'
import type { WorkspaceAPI } from '../../src/shared/ipc/workspace'
import { createDesktopTestEnv } from './desktop-test-env'

interface DesktopAPI {
  system: { setLanguage(language: string): Promise<void> }
  experimental: ExperimentalAPI
  session: SessionAPI
  terminal: TerminalAPI
  workspace: WorkspaceAPI
}

type DesktopWindow = Window & { electron: DesktopAPI }
type ElectronProcess = ReturnType<ElectronApplication['process']>

const PROCESS_EXIT_TIMEOUT = 5_000
const HANDOFF_MARKER = '继续任务'
const PROVIDER_SESSION_ID = 'sess-ext-1'

const FAKE_AGENT_JS = [
  "const fs = require('fs')",
  "const path = require('path')",
  'const dir = __dirname',
  "fs.writeFileSync(path.join(dir, 'argv-' + process.pid + '.json'), JSON.stringify(process.argv.slice(2)))",
  "process.stdout.write('\\u001b[?2004hfake-agent ready> ')",
  "process.stdin.on('data', (chunk) => {",
  '  try {',
  "    fs.appendFileSync(path.join(dir, 'got-' + process.pid + '.txt'), chunk.toString('utf8'))",
  '  } catch {}',
  '})',
  'setInterval(() => {}, 1000)',
  '',
].join('\n')

const FAKE_AGENT_CMD = '@echo off\r\nnode "%~dp0fake-agent.js" %*\r\n'

function claudeUser(text: string, sessionId: string, cwd: string, timestamp: string) {
  return { type: 'user', message: { role: 'user', content: text }, sessionId, cwd, timestamp }
}

function claudeAssistant(text: string, sessionId: string, cwd: string, timestamp: string) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    sessionId,
    cwd,
    timestamp,
  }
}

/** Fixture PATH: our fake agent shims win `where claude` / `where pi` resolution. */
function fixtureEnv(fixtureRoot: string, binDir: string): NodeJS.ProcessEnv {
  const env = createDesktopTestEnv(fixtureRoot)
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const cleaned = (env[pathKey] ?? '')
    .split(';')
    .filter(Boolean)
    .filter((entry) => {
      for (const shim of ['claude.cmd', 'claude.exe', 'codex.cmd', 'codex.exe', 'opencode.cmd', 'opencode.exe', 'pi.cmd', 'pi.exe']) {
        if (existsSync(join(entry, shim))) return false
      }
      return true
    })
  env[pathKey] = [binDir, ...cleaned].join(';')
  env.CLAUDE_CONFIG_DIR = join(fixtureRoot, '.claude')
  env.CODEX_HOME = join(fixtureRoot, '.codex')
  env.XDG_DATA_HOME = join(fixtureRoot, '.local', 'share')
  return env
}

async function readFakeAgentState(binDir: string): Promise<{ argvs: string[][]; inputs: string }> {
  const files = await readdir(binDir)
  const argvs: string[][] = []
  let inputs = ''
  for (const file of files) {
    if (file.startsWith('argv-') && file.endsWith('.json')) {
      argvs.push(JSON.parse(await readFile(join(binDir, file), 'utf-8')) as string[])
    }
    if (file.startsWith('got-') && file.endsWith('.txt')) {
      inputs += await readFile(join(binDir, file), 'utf-8')
    }
  }
  return { argvs, inputs }
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

async function listLive(page: Page): Promise<AgentSessionSummary[]> {
  return page.evaluate(() => (window as DesktopWindow).electron.session.list())
}

test('Continue in New Session mints one card, delivers one handoff, and fails without ghosts', async () => {
  test.setTimeout(150_000)
  const entry = resolve('out/main/index.js')
  let fixtureRoot: string | undefined
  let application: ElectronApplication | undefined
  let page: Page | undefined

  try {
    await accessFixture(entry)
    fixtureRoot = await mkdtemp(join(tmpdir(), 'janusx-session-continue-'))
    const binDir = join(fixtureRoot, 'bin')
    const userDataDir = join(fixtureRoot, 'user-data')
    const workspacePath = join(fixtureRoot, 'workspace')
    const doomedPath = join(fixtureRoot, 'doomed')
    const transcriptPath = join(fixtureRoot, '.claude', 'projects', 'proj', `${PROVIDER_SESSION_ID}.jsonl`)
    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(userDataDir, { recursive: true }),
      mkdir(workspacePath, { recursive: true }),
      mkdir(doomedPath, { recursive: true }),
      mkdir(join(fixtureRoot, '.claude', 'projects', 'proj'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(binDir, 'fake-agent.js'), FAKE_AGENT_JS, 'utf-8'),
      writeFile(join(binDir, 'claude.cmd'), FAKE_AGENT_CMD, 'utf-8'),
      writeFile(join(binDir, 'pi.cmd'), FAKE_AGENT_CMD, 'utf-8'),
      writeFile(
        transcriptPath,
        [
          JSON.stringify(
            claudeUser('fix the login retry', PROVIDER_SESSION_ID, workspacePath, '2026-10-10T10:00:00.000Z'),
          ),
          JSON.stringify(
            claudeAssistant(
              'login retry fixed',
              PROVIDER_SESSION_ID,
              workspacePath,
              '2026-10-10T10:01:00.000Z',
            ),
          ),
          '',
        ].join('\n'),
        'utf-8',
      ),
    ])

    application = await electron.launch({
      args: [entry, `--user-data-dir=${userDataDir}`],
      env: fixtureEnv(fixtureRoot, binDir),
    })
    page = await application.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => {
      const api = (window as DesktopWindow).electron
      return Boolean(api?.session?.continue && api?.terminal?.create && api?.workspace?.create)
    })
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('zh-CN'))

    const workspace = await page.evaluate(
      ({ workspacePath }) =>
        (window as DesktopWindow).electron.workspace.create({
          name: 'Continue drill',
          path: workspacePath,
        }),
      { workspacePath },
    )

    // Source row: an agent terminal mints its session exactly once.
    await page.evaluate(
      ({ workspaceId, workspacePath }) =>
        (window as DesktopWindow).electron.terminal.create({
          id: 'source-terminal',
          workspaceId,
          cwd: workspacePath,
          shell: 'powershell.exe',
          preset: 'claude',
        }),
      { workspaceId: workspace.id, workspacePath },
    )
    const source = (await listLive(page)).find((row) => row.engine === 'claude' && row.external !== true)
    expect(source, 'source terminal mints one internal claude row').toBeTruthy()

    // AC-4 machine side: one Continue produces exactly one new card, the
    // original row stays intact, and the handoff lands in the new session.
    const beforeContinue = (await listLive(page)).length
    const continued = await page.evaluate(
      (sessionId) => (window as DesktopWindow).electron.session.continue({ sessionId }),
      source!.id,
    )
    await expect
      .poll(async () => (await listLive(page)).length, { timeout: 15_000 })
      .toBe(beforeContinue + 1)
    const rows = await listLive(page)
    const newRow = rows.find((row) => row.id === continued.sessionId)
    expect(newRow?.continuedFrom).toBe(source!.id)
    expect(newRow?.cwd).toBe(workspacePath)
    expect(rows.find((row) => row.id === source!.id), 'original session stays resumable').toBeTruthy()

    await expect
      .poll(
        async () => {
          const detail = await page!.evaluate(
            (sessionId) => (window as DesktopWindow).electron.session.get(sessionId),
            continued.sessionId,
          )
          return { prompt: detail?.firstPrompt ?? '', pending: detail?.pendingHandoff ?? null }
        },
        { timeout: 20_000 },
      )
      .toEqual({ prompt: expect.stringContaining(HANDOFF_MARKER), pending: null })
    await expect
      .poll(async () => (await readFakeAgentState(binDir)).inputs, { timeout: 20_000 })
      .toContain(HANDOFF_MARKER)

    // Live UI drill: enable the gated sessions tool, then one click of 在新会话中继续
    // grows the card list by exactly one.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => {
      const api = (window as DesktopWindow).electron
      return Boolean(api?.session?.list && api?.experimental?.get)
    })
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('zh-CN'))
    const workspaceRow = page.locator('.ws').filter({ hasText: 'Continue drill' }).first()
    await expect(workspaceRow).toBeVisible({ timeout: 10_000 })
    await workspaceRow.click()
    await page.getByRole('button', { name: /打开会话工具/ }).click()
    await expect(page.getByRole('region', { name: /会话/ })).toBeVisible()

    // Count live cards, since actions are only rendered for the expanded card.
    const sessionCards = page.getByRole('region', { name: /会话/ }).locator('[data-session-id]')
    await expect(sessionCards).toHaveCount(3, { timeout: 10_000 })
    const internalCard = page.locator('div[class*="cardSurface"]')
      .filter({ hasText: HANDOFF_MARKER }).first()
    await internalCard.getByRole('button', { name: '展开', exact: true }).click()
    const xtermsBeforeUiContinue = await page.locator('.xterm-rows').count()
    await internalCard.getByRole('button', { name: '在新会话中继续', exact: true }).click()
    await expect(page.getByRole('button', { name: '开始新会话', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '开始新会话', exact: true }).click()
    await expect(sessionCards).toHaveCount(4, { timeout: 15_000 })
    // The workbench must mount the new terminal view, not just the ledger row:
    // the terminal:created subscription is app-level, so a main-side launch
    // bootstraps even when the pane tree was empty before it.
    await expect
      .poll(async () => page.locator('.xterm-rows').count(), { timeout: 15_000 })
      .toBeGreaterThan(xtermsBeforeUiContinue)

    // Note: collapsing an extension view must leave its host-owned PTY alive — see
    // .agents/notes/workbench/requirements/plugin-architecture-forms.md (AC-6).
    await page.locator('#right-tool-rail-sessions').click()
    await page.mouse.move(0, 0)
    await expect(page.getByTestId('right-tool-panel-shell')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.getByTestId('right-tool-panel-shell')).toHaveAttribute('inert', '')
    const liveMarker = 'extension-panel-closed-still-running'
    await page.evaluate(({ terminalId, marker }) => {
      (window as DesktopWindow).electron.terminal.input(terminalId, `${marker}\r`)
    }, { terminalId: continued.terminalId, marker: liveMarker })
    await expect.poll(async () => (await readFakeAgentState(binDir)).inputs, { timeout: 10_000 }).toContain(liveMarker)
    expect((await listLive(page)).some((row) => row.id === continued.sessionId)).toBe(true)
    await page.getByRole('button', { name: /打开会话工具/ }).click()
    await expect(sessionCards).toHaveCount(4, { timeout: 10_000 })

    // AC-8 machine side: an external row keeps Resume and 在新会话中继续 side by
    // side, and Resume re-enters the provider session id in a fresh terminal.
    const external = (await listLive(page)).find((row) => row.external === true)
    expect(external, 'boot backfill imports the fake transcript').toBeTruthy()
    expect(external?.providerSessionId).toBe(PROVIDER_SESSION_ID)
    const externalCard = page.locator(`[data-session-id="${external!.id}"]`)
    const externalFold = externalCard.getByRole('button', { name: '展开', exact: true })
    if ((await externalFold.count()) > 0) await externalFold.click()
    const resumeButton = externalCard.getByRole('button', { name: '回到原会话', exact: true })
    await expect(resumeButton).toHaveCount(1, { timeout: 10_000 })
    await resumeButton.click()
    await expect
      .poll(async () => (await readFakeAgentState(binDir)).argvs, { timeout: 20_000 })
      .toContainEqual(expect.arrayContaining(['--resume', PROVIDER_SESSION_ID]))
    await expect
      .poll(async () => (await listLive(page)).filter((row) => row.continuedFrom === external!.id).length, {
        timeout: 15_000,
      })
      .toBe(1)

    // Regression: Continue on an external Claude row resumes its provider
    // history in the active workspace without submitting the first prompt.
    const argvBefore = (await readFakeAgentState(binDir)).argvs.length
    const xtermsBeforeExtContinue = await page.locator('.xterm-rows').count()
    const rowsBeforeContinue = await listLive(page)
    await externalCard.getByRole('button', { name: '在新会话中继续', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复对话', exact: true })).toBeVisible()
    await expect(page.locator('div.fixed.inset-0').last()).not.toContainText('fix the login retry')
    await page.getByRole('button', { name: '恢复对话', exact: true }).click()
    await expect
      .poll(async () => (await readFakeAgentState(binDir)).argvs.length, { timeout: 20_000 })
      .toBe(argvBefore + 1)
    await expect
      .poll(async () => page.locator('.xterm-rows').count(), { timeout: 15_000 })
      .toBeGreaterThan(xtermsBeforeExtContinue)
    await expect
      .poll(async () => (await readFakeAgentState(binDir)).argvs, { timeout: 20_000 })
      .toContainEqual(expect.arrayContaining(['--resume', PROVIDER_SESSION_ID]))
    const extContinued = (await listLive(page)).find(
      (row) => !rowsBeforeContinue.some((before) => before.id === row.id),
    )
    expect(extContinued?.continuedFrom).toBe(external!.id)
    expect(extContinued?.workspaceId).toBe(workspace.id)

    // A create that never comes up archives its empty row: no ghost card.
    await page.evaluate(
      ({ workspaceId, doomedPath }) =>
        (window as DesktopWindow).electron.terminal.create({
          id: 'doomed-terminal',
          workspaceId,
          cwd: doomedPath,
          shell: 'powershell.exe',
          preset: 'pi',
        }),
      { workspaceId: workspace.id, doomedPath },
    )
    const doomed = (await listLive(page)).find((row) => row.engine === 'pi' && row.external !== true)
    expect(doomed, 'doomed source row exists before its resume argv can fail').toBeTruthy()
    await rm(join(binDir, 'pi.cmd'), { force: true })
    const beforeFailed = (await listLive(page)).length
    let failedCreate = false
    try {
      await page.evaluate(
        (sessionId) => (window as DesktopWindow).electron.session.continue({ sessionId }),
        doomed!.id,
      )
    } catch {
      failedCreate = true
    }
    expect(failedCreate, 'failed create surfaces instead of silently succeeding').toBe(true)
    expect((await listLive(page)).length).toBe(beforeFailed)
  } finally {
    if (page && !page.isClosed()) {
      await page
        .evaluate(async () => {
          const api = (window as DesktopWindow).electron
          const rows = await api.session.list({ includeArchived: true }).catch(() => [])
          for (const row of rows) {
            const detail = await api.session.get(row.id).catch(() => null)
            for (const terminalId of detail?.terminalIds ?? []) {
              await api.terminal.kill(terminalId).catch(() => undefined)
            }
          }
        })
        .catch(() => undefined)
    }
    await closeApplication(application)
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function accessFixture(entry: string): Promise<void> {
  if (!existsSync(entry)) {
    throw new Error(`Built desktop entry missing at ${entry}; run npm run build before the desktop project`)
  }
}

test('external Codex growth refreshes the open conversation without reopening or manual scans', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'janusx-codex-live-'))
  let application: ElectronApplication | undefined
  try {
    const cwd = join(fixtureRoot, 'workspace')
    const binDir = join(fixtureRoot, 'bin')
    const store = join(fixtureRoot, '.codex', 'sessions')
    await Promise.all([mkdir(cwd), mkdir(binDir), mkdir(store, { recursive: true })])
    const transcript = join(store, 'rollout-external-live.jsonl')
    const user = (text: string) => ({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text }] } })
    const assistant = (text: string) => ({ type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text }] } })
    await writeFile(transcript, [
      { type: 'session_meta', payload: { id: 'external-live', cwd, instructions: 'x'.repeat(80000) } },
      user('external initial question'), assistant('external initial answer'),
      { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(600000) } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n')
    application = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixtureRoot, 'user-data')}`],
      env: fixtureEnv(fixtureRoot, binDir),
    })
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((path) => (window as DesktopWindow).electron.workspace.create({ name: 'Codex live drill', path }), cwd)
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('zh-CN'))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.ws').filter({ hasText: 'Codex live drill' }).first().click()
    await page.getByRole('button', { name: /打开会话工具|Open Sessions tool/ }).click()
    await expect.poll(async () => (await listLive(page)).find((row) => row.providerSessionId === 'external-live')).toBeTruthy()
    const source = (await listLive(page)).find((row) => row.providerSessionId === 'external-live')!
    const card = page.locator(`[data-session-id="${source.id}"]`)
    await card.getByRole('button', { name: '展开', exact: true }).click()
    await expect(card).toContainText('external initial answer')
    await card.getByRole('button', { name: '查看详情', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('external initial answer')

    await appendFile(transcript, JSON.stringify(user('external follow-up question')) + '\n')
    const pendingQuestion = dialog.getByText('external follow-up question', { exact: true })
    await expect(pendingQuestion).toBeVisible({ timeout: 20_000 })
    await expect(pendingQuestion.locator('..').locator('..')).not.toContainText('external initial answer')
    await appendFile(transcript, JSON.stringify(assistant('external updated answer')) + '\n')
    await expect(dialog).toContainText('external updated answer', { timeout: 20_000 })
    await expect(dialog).toContainText('external follow-up question')
    await expect(card).toContainText('2 轮次')
    await page.keyboard.press('Escape')
    await expect(card).toContainText('external updated answer')
  } finally {
    await closeApplication(application)
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function seedRecoveryFixture(fixtureRoot: string, cwd: string) {
  const binDir = join(fixtureRoot, 'bin')
  await mkdir(binDir)
  await mkdir(cwd)
  const manifest = {
    claude: { id: 'claude-native', transcriptPath: join(fixtureRoot, 'original-claude', 'projects', 'repo', 'claude-native.jsonl') },
    codex: { id: 'codex-native', transcriptPath: join(fixtureRoot, 'original-codex', 'sessions', '2026', 'rollout-date-codex-native.jsonl') },
    opencode: { id: 'ses_native', transcriptPath: join(fixtureRoot, '.local', 'share', 'opencode', 'opencode.db') },
  }
  for (const [engine, source] of Object.entries(manifest)) {
    await mkdir(resolve(source.transcriptPath, '..'), { recursive: true })
    await writeFile(join(binDir, engine + '.cmd'), `@echo off\r\nnode "%~dp0recovery-agent.cjs" ${engine} %*\r\n`)
  }
  await writeFile(join(binDir, 'recovery-agent.cjs'), await readFile(resolve('tests/fixtures/session-recovery-agent.cjs')))
  await writeFile(join(binDir, 'recovery-manifest.json'), JSON.stringify(manifest))
  await writeFile(manifest.claude.transcriptPath, [
    claudeUser('seed Claude history', manifest.claude.id, cwd, '2026-10-10T10:00:00Z'),
    claudeAssistant('seed Claude answer', manifest.claude.id, cwd, '2026-10-10T10:01:00Z'),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n')
  await writeFile(manifest.codex.transcriptPath, [
    { type: 'session_meta', payload: { id: manifest.codex.id, cwd } },
    { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'seed Codex history' }] } },
    { type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: 'seed Codex answer' }] } },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n')
  const db = new DatabaseSync(manifest.opencode.transcriptPath)
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`)
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run(manifest.opencode.id, cwd, 'Seed Opencode', 1000, 2000)
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('seed', manifest.opencode.id, 1000, JSON.stringify({ role: 'user' }))
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run('seed', 'seed', manifest.opencode.id, 1000, JSON.stringify({ type: 'text', text: 'seed Opencode history' }))
  db.close()
  return { binDir, manifest }
}

async function submitFixturePrompt(page: Page, id: string, prompt: string) {
  await page.evaluate(({ id, prompt }) => {
    const api = (window as DesktopWindow).electron.terminal
    api.submitLine(id, prompt)
    api.input(id, prompt + '\r')
  }, { id, prompt })
}

test('Claude, Codex and Opencode restore native history and track follow-up turns', async () => {
  test.setTimeout(150_000)
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'janusx-native-recovery-'))
  let application: ElectronApplication | undefined
  let page: Page | undefined
  const terminalIds: string[] = []
  try {
    const cwd = join(fixtureRoot, 'workspace')
    const { binDir, manifest } = await seedRecoveryFixture(fixtureRoot, cwd)
    application = await electron.launch({ args: [resolve(process.env.JANUSX_DESKTOP_ENTRY ?? 'out/main/index.js'), `--user-data-dir=${join(fixtureRoot, 'user-data')}`], env: fixtureEnv(fixtureRoot, binDir) })
    page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const workspace = await page.evaluate((path) => (window as DesktopWindow).electron.workspace.create({ name: 'Recovery drill', path }), cwd)
    // 中文必须在 reload 之前设好：reload 之后整套界面才是中文，后面一连串中文
    // locator（继续/恢复对话等）才不会因为语言切换的传播时序而间歇性失配。
    await page.evaluate(() => (window as DesktopWindow).electron.system.setLanguage('zh-CN'))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.ws').filter({ hasText: 'Recovery drill' }).first().click()
    await page.getByRole('button', { name: /打开会话工具|Open Sessions tool/ }).click()
    for (const engine of ['claude', 'codex', 'opencode'] as const) {
      const sourceTerminal = 'source-' + engine
      terminalIds.push(sourceTerminal)
      await page.evaluate(({ id, cwd, workspaceId, preset }) => (window as DesktopWindow).electron.terminal.create({ id, cwd, workspaceId, preset, shell: 'powershell.exe' }),
        { id: sourceTerminal, cwd, workspaceId: workspace.id, preset: engine })
      await expect.poll(async () => existsSync(join(binDir, 'launch-' + sourceTerminal + '.json'))).toBe(true)
      const source = (await listLive(page)).find((row) => row.engine === engine && !row.external && !row.continuedFrom)!
      expect(source).toBeTruthy()
      const beforeMissingId = (await listLive(page)).length
      await expect(page.evaluate((sessionId) => (window as DesktopWindow).electron.session.continue({ sessionId, mode: 'resume' }), source.id)).rejects.toThrow('identity')
      expect((await listLive(page)).length).toBe(beforeMissingId)
      await submitFixturePrompt(page, sourceTerminal, 'initial ' + engine + ' prompt')
      await expect.poll(async () => ({
        engine,
        count: (await page!.evaluate((id) => (window as DesktopWindow).electron.session.get(id), source.id))?.turnCount,
        input: await readFile(join(binDir, 'input-' + sourceTerminal + '.txt'), 'utf8').catch(() => ''),
        error: await readFile(join(binDir, 'error-' + sourceTerminal + '.txt'), 'utf8').catch(() => ''),
      })).toEqual({ engine, count: 1, input: expect.stringContaining('initial ' + engine + ' prompt'), error: '' })
      const bound = await page.evaluate((id) => (window as DesktopWindow).electron.session.get(id), source.id)
      expect(bound?.providerSessionId).toBe(manifest[engine].id)
      expect(bound?.transcriptPath).toBe(manifest[engine].transcriptPath)
      const argv = engine === 'claude' ? ['--resume', manifest[engine].id] : engine === 'codex' ? ['resume', manifest[engine].id] : ['--session', manifest[engine].id]
      for (const mode of ['continue', 'resume'] as const) {
        const beforeRows = await listLive(page)
        const sourceCard = page.locator(`[data-session-id="${source.id}"]`)
        await expect(sourceCard).toBeVisible()
        await expect(sourceCard).not.toContainText('还原点')
        const fold = sourceCard.getByRole('button', { name: '展开', exact: true })
        if (await fold.count()) await fold.click()
        if (mode === 'continue') {
          await sourceCard.getByRole('button', { name: '在新会话中继续', exact: true }).click()
          await expect(page.getByRole('button', { name: '恢复对话', exact: true })).toBeVisible()
          await expect(page.locator('div.fixed.inset-0').last()).not.toContainText('initial ' + engine + ' prompt')
          await page.getByRole('button', { name: '恢复对话', exact: true }).click()
        } else {
          await expect(sourceCard.getByRole('button', { name: '回到原会话', exact: true })).toBeEnabled()
          await sourceCard.getByRole('button', { name: '查看详情', exact: true }).click()
          const detailWindow = page.getByRole('dialog')
          await expect(detailWindow).toContainText('initial ' + engine + ' prompt')
          await expect(detailWindow).not.toContainText('还原点')
          await expect(detailWindow.getByRole('button', { name: /查看 diff|确认恢复/ })).toHaveCount(0)
          await detailWindow.getByRole('button', { name: '回到原会话', exact: true }).click()
        }
        await expect.poll(async () => (await listLive(page!)).length).toBe(beforeRows.length + 1)
        const newRow = (await listLive(page)).find((row) => !beforeRows.some((before) => before.id === row.id))!
        const newDetail = await page.evaluate((id) => (window as DesktopWindow).electron.session.get(id), newRow.id)
        const result = { sessionId: newRow.id, terminalId: newDetail!.terminalIds[0] }
        terminalIds.push(result.terminalId)
        await expect.poll(async () => existsSync(join(binDir, 'launch-' + result.terminalId + '.json'))).toBe(true)
        const launch = JSON.parse(await readFile(join(binDir, 'launch-' + result.terminalId + '.json'), 'utf8'))
        expect(launch).toMatchObject({ cwd, transcriptPath: manifest[engine].transcriptPath, hooksInstalled: true })
        expect(launch.args.slice(-argv.length)).toEqual(argv)
        if (engine !== 'codex') expect(launch.hooksPath).toContain(join(fixtureRoot, 'user-data'))
        expect(launch.history).toContain('seed ' + (engine === 'claude' ? 'Claude' : engine === 'codex' ? 'Codex' : 'Opencode') + ' history')
        expect(existsSync(join(binDir, 'input-' + result.terminalId + '.txt')), 'native restore must not inject a prompt').toBe(false)
        expect((await listLive(page)).length).toBe(beforeRows.length + 1)
        const restored = await page.evaluate((id) => (window as DesktopWindow).electron.session.get(id), result.sessionId)
        expect(restored).toMatchObject({ continuedFrom: source.id, providerSessionId: manifest[engine].id,
          transcriptPath: manifest[engine].transcriptPath, firstPrompt: 'initial ' + engine + ' prompt', turnCount: 1, checkpointCount: 0 })
        expect(restored?.pendingHandoff).toBeUndefined()
        await submitFixturePrompt(page, result.terminalId, 'follow-up ' + engine + ' ' + mode)
        await expect.poll(async () => (await page!.evaluate((id) => (window as DesktopWindow).electron.session.get(id), result.sessionId))?.turnCount).toBe(2)
        const transcript = await page.evaluate((id) => (window as DesktopWindow).electron.session.getTranscript(id), result.sessionId)
        expect(JSON.stringify(transcript)).toContain('answer to follow-up ' + engine + ' ' + mode)
        expect((await page.evaluate((id) => (window as DesktopWindow).electron.session.get(id), source.id))?.turnCount).toBe(1)
      }
      const beforeFailure = (await listLive(page)).length
      await expect(page.evaluate((sessionId) => (window as DesktopWindow).electron.session.continue({ sessionId, mode: 'resume', engine: 'pi' }), source.id)).rejects.toThrow('change')
      if (engine === 'claude') expect(existsSync(join(fixtureRoot, 'original-claude', 'settings.json'))).toBe(false)
      if (engine === 'codex') expect(existsSync(join(fixtureRoot, 'original-codex', 'hooks.json'))).toBe(false)
      await rm(manifest[engine].transcriptPath)
      await expect(page.evaluate((sessionId) => (window as DesktopWindow).electron.session.continue({ sessionId, mode: 'continue' }), source.id)).rejects.toThrow('history')
      expect((await listLive(page)).length).toBe(beforeFailure)
    }
  } finally {
    if (page && !page.isClosed()) {
      for (const id of terminalIds) await page.evaluate((id) => (window as DesktopWindow).electron.terminal.kill(id), id).catch(() => undefined)
    }
    await closeApplication(application)
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
  }
})
