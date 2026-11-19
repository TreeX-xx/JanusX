import { enableSuperAgentPlugin } from './superagent-plugin'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { controlledGit } from '../../src/main/git/controlled-worktree'
import { hookCliFixture } from '../helpers/hook-cli-fixture'
import { seedIntroducedLearning } from './desktop-test-env'

// Deliberately opt in: normal verify never uses credentials or a paid model.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(!process.env.JANUS_SUPERAGENT_LIVE_CONFIG || !process.env.JANUS_SUPERAGENT_LIVE_CODEX_HOME
  || !process.env.JANUS_SUPERAGENT_CODEX_BINARY || process.platform !== 'win32', 'Requires explicitly selected live configuration and native credentials')

test('live Janus and Codex develop a bounded fixture and distinguish recall from continuation', async () => {
  test.setTimeout(600000)
  const cli = await hookCliFixture()
  const profile = join(cli.root, 'profile'), configPath = join(profile, 'janusx', 'llm-config.json')
  const nativeSource = process.env.JANUS_SUPERAGENT_LIVE_CODEX_HOME!
  const config = await readFile(process.env.JANUS_SUPERAGENT_LIVE_CONFIG!, 'utf8')
  const nativeConfig = await readFile(join(nativeSource, 'config.toml'), 'utf8')
  let fixtureNativeConfig = nativeConfig + `\n[projects.${JSON.stringify(cli.cwd)}]\ntrust_level="trusted"\n`
  await mkdir('artifacts/superagent-p8', { recursive: true })
  await writeFile('artifacts/superagent-p8/live-fixture.json', JSON.stringify({ root: cli.root, codexHome: cli.env.CODEX_HOME, configPath }))
  let application: ElectronApplication | undefined
  let scope = ''
  try {
    await mkdir(dirname(configPath), { recursive: true })
    const document = JSON.parse(config)
    const selectedProvider = process.env.JANUS_SUPERAGENT_LIVE_PROVIDER
    if (selectedProvider) {
      const provider = document.providers[selectedProvider]
      if (!provider) throw new Error('Selected live provider is absent')
      document.bindings.janus = { mode: 'provider', providerId: selectedProvider, modelId: provider.modelId }
    }
    if (process.env.JANUS_SUPERAGENT_LIVE_MODEL) document.bindings.janus.modelId = process.env.JANUS_SUPERAGENT_LIVE_MODEL
    const contextWindow = Number(process.env.JANUS_SUPERAGENT_LIVE_CONTEXT)
    const maxOutputTokens = Number(process.env.JANUS_SUPERAGENT_LIVE_OUTPUT)
    if (Number.isSafeInteger(contextWindow) && contextWindow > 0 && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0) {
      const binding = document.bindings.janus, provider = document.providers[binding.providerId]
      provider.extra = { ...provider.extra, chatModelLimits: { ...provider.extra?.chatModelLimits,
        [binding.modelId]: { contextWindow, maxOutputTokens } } }
    }
    // Only Janus uses the copied provider. Worker uses the selected native account.
    for (const consumer of ['claude', 'codex', 'opencode', 'pi']) document.bindings[consumer] = { mode: 'native' }
    await writeFile(configPath, JSON.stringify(document))
    await copyFile(join(nativeSource, 'auth.json'), join(cli.env.CODEX_HOME!, 'auth.json'))
    await writeFile(join(cli.env.CODEX_HOME!, 'config.toml'), fixtureNativeConfig)
    await controlledGit(cli.cwd, ['init', '-b', 'main'])
    await controlledGit(cli.cwd, ['config', 'user.name', 'SuperAgent live acceptance'])
    await controlledGit(cli.cwd, ['config', 'user.email', 'acceptance@example.invalid'])
    await writeFile(join(cli.cwd, 'README.md'), 'Temporary acceptance fixture. No project or personal data.\n')
    await controlledGit(cli.cwd, ['add', 'README.md'])
    await controlledGit(cli.cwd, ['commit', '-m', 'Fixture baseline'])
    const env = { ...cli.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(cli.root, 'knowledge') }
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      if (process.env[key]) env[key] = process.env[key]
    }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${dirname(process.env.JANUS_SUPERAGENT_CODEX_BINARY!)};${env[pathKey] ?? ''}`
    application = await electron.launch({ args: [resolve('.'), `--user-data-dir=${profile}`], env })
    await seedIntroducedLearning(application.context())
    const page = await application.firstWindow({ timeout: 45000 })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 1000))
    await page.waitForFunction(() => Boolean(window.electron?.superAgent))
    scope = await page.evaluate(async path => {
      await window.electron.system.setLanguage('en')
      const workspace = await window.electron.workspace.create({ name: 'Live acceptance fixture', path })
      await window.electron.workspace.load(workspace.id)
      return workspace.id
    }, cli.cwd)
    await page.reload()
    await page.locator('.ws').filter({ hasText: 'Live acceptance fixture' }).first().click()
    await enableSuperAgentPlugin(application, page)
    await page.getByRole('button', { name: 'Super Agent', exact: true }).click()
    const chat = page.locator('[data-superagent-workspace] .janus-chat')
    const input = chat.locator('textarea.janus-chat-input')
    const send = async (text: string) => { await input.fill(text); await input.press('Enter') }
    const trustedPaths = new Set([cli.cwd])
    const waitForReady = async (count: number) => {
      let outcome = 'waiting', diagnostic = ''
      await expect.poll(async () => {
        for (const operation of (await page.evaluate(id => window.electron.superAgent.environments(id), scope)).operations) {
          if (operation.status === 'pending' && operation.plan.kind === 'create' && !trustedPaths.has(operation.plan.targetPath)) {
            trustedPaths.add(operation.plan.targetPath)
            fixtureNativeConfig += `\n[projects.${JSON.stringify(operation.plan.targetPath)}]\ntrust_level="trusted"\n`
            await writeFile(join(cli.env.CODEX_HOME!, 'config.toml'), fixtureNativeConfig)
          }
        }
        const decisions = page.getByRole('region', { name: 'Worker decisions' })
        for (const name of ['Create and start', 'Allow once']) for (const button of await decisions.getByRole('button', { name, exact: true }).all()) {
          if (await button.isEnabled().catch(() => false)) await button.click({ timeout: 1000 }).catch(() => undefined)
        }
        // Answer only permission for the three host-owned Worker MCP tools.
        // An unrelated model question must stay visible for a human decision.
        for (const form of await decisions.locator('form').filter({ hasText: /Allow the janus_worker MCP server to run tool "(?:read_work|read_resource|report_work)"\?/ }).all()) {
          const accept = form.getByRole('radio', { name: 'Submit answers', exact: true })
          if (await accept.isEnabled().catch(() => false)) await accept.check({ timeout: 1000 })
          const submit = form.getByRole('button', { name: 'Submit answer', exact: true })
          if (await submit.isEnabled().catch(() => false)) await submit.click({ timeout: 1000 })
        }
        const state = await page.evaluate(async id => ({ records: await window.electron.superAgent.snapshot(id),
          workers: await window.electron.superAgent.workers(id) }), scope)
        const failed = state.workers.find(worker => worker.phase === 'failed')
        diagnostic = failed?.diagnostic ?? failed?.conversation.error ?? ''
        outcome = failed ? 'failed' : state.records.reports.filter(row => row.kind === 'ready').length === count
          && state.workers.every(worker => worker.stopConfirmed) ? 'ready' : 'waiting'
        return outcome
      }, { timeout: 150000 }).not.toBe('waiting')
      expect(outcome, diagnostic || 'Native Worker must actually report ready').toBe('ready')
    }
    await send('请安排 Codex Worker 在这个临时仓库开发一个很小的功能：创建 greet.cjs，导出 greet(name)，返回 Hello, name!。创建 greet.test.cjs，用 node:assert/strict 验证 greet("Janus") === "Hello, Janus!"，并执行 node greet.test.cjs。只修改这两个文件，不提交、不联网安装依赖。完成后通过 report_work 汇报实际检查。请直接安排执行，不只是给建议。')
    await expect.poll(async () => (await page.evaluate(id => window.electron.superAgent.snapshot(id), scope)).works.length, { timeout: 90000 }).toBe(1)
    await waitForReady(1)
    const first = await page.evaluate(id => window.electron.superAgent.snapshot(id), scope)
    const checkout = (await page.evaluate(id => window.electron.superAgent.environments(id), scope)).environments[0].checkout.path
    await promisify(execFile)(process.execPath, ['greet.test.cjs'], { cwd: checkout, windowsHide: true })
    const firstExecution = first.works[0].latestExecutionId
    const answers = await chat.locator('.janus-chat-message.assistant').count()
    await send('刚才的 greet 功能修改了什么、做了什么验证？这条只查询历史，不执行或修改。')
    await expect.poll(() => chat.locator('.janus-chat-message.assistant').count(), { timeout: 180000 }).toBeGreaterThan(answers)
    // Wait for this answer to finish before checking it did not start another execution.
    await expect(chat.locator('button.janus-chat-stop')).toHaveCount(0, { timeout: 180000 })
    await expect(chat.locator('.janus-chat-error-card')).toHaveCount(0)
    await expect(chat.locator('.janus-chat-message.assistant').last()).toContainText(/greet|Janus/)
    const recalled = await page.evaluate(id => window.electron.superAgent.snapshot(id), scope)
    expect(recalled.works).toHaveLength(1)
    expect(recalled.works[0].latestExecutionId).toBe(firstExecution)
    await send('请继续刚才的 greet 功能：没有传 name 时默认用 world，并增加 greet() === "Hello, world!" 的测试，执行 node greet.test.cjs，完成后汇报。仍只改这两个文件，不提交。')
    await waitForReady(2)
    const continued = await page.evaluate(id => window.electron.superAgent.snapshot(id), scope)
    expect(continued.works).toHaveLength(1)
    expect(continued.works[0].latestExecutionId).not.toBe(firstExecution)
    await promisify(execFile)(process.execPath, ['greet.test.cjs'], { cwd: checkout, windowsHide: true })
    await promisify(execFile)(process.execPath, ['-e', 'const g=require("./greet.cjs");const f=typeof g==="function"?g:g.greet;require("node:assert/strict").equal(f(),"Hello, world!")'], { cwd: checkout, windowsHide: true })
    await mkdir('artifacts/superagent-p8', { recursive: true })
    await writeFile('artifacts/superagent-p8/live-result.json', JSON.stringify({ model: document.bindings.janus.modelId,
      works: continued.works.length, executions: continued.executions.length, reports: continued.reports.map(row => ({ kind: row.kind, summary: row.summary })),
      historyDidNotExecute: true, testsPassed: true }, null, 2))
    await page.screenshot({ path: 'artifacts/superagent-p8/live-desktop.png' })
    expect(await readFile(process.env.JANUS_SUPERAGENT_LIVE_CONFIG!, 'utf8')).toBe(config)
    expect(await readFile(join(nativeSource, 'config.toml'), 'utf8')).toBe(nativeConfig)
  } finally {
    if (application) {
      const child = application.process()
      const page = application.windows()[0]
      if (page && scope) {
        await mkdir('artifacts/superagent-p8', { recursive: true })
        await writeFile('artifacts/superagent-p8/live-last.txt', await page.locator('body').innerText().catch(() => 'No workspace view'))
        const outcome = await page.evaluate(async id => {
          const records = await window.electron.superAgent.snapshot(id)
          return { works: records.works.length, reports: records.reports.map(row => row.kind),
            workers: (await window.electron.superAgent.workers(id)).map(worker => ({ phase: worker.phase,
              diagnostic: worker.diagnostic ?? worker.conversation.error, stopConfirmed: worker.stopConfirmed,
              threadId: worker.conversation.threadId })) }
        }, scope).catch(() => ({ unavailable: true }))
        await writeFile('artifacts/superagent-p8/live-outcome.json', JSON.stringify(outcome, null, 2))
      }
      await Promise.race([application.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 10000))])
      if (child.pid && child.exitCode === null) await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
    }
    // Remove only this test's credential copies, never the selected source files.
    await rm(configPath, { force: true })
    await rm(join(cli.env.CODEX_HOME!, 'auth.json'), { force: true })
    await rm(join(cli.env.CODEX_HOME!, 'config.toml'), { force: true })
    await cli.close()
  }
})
