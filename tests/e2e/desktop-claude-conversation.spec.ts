import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { claudeConversationFixture } from '../helpers/claude-conversation-fixture'
import { seedIntroducedLearning } from './desktop-test-env'

const binary = process.env.JANUSX_TEST_CLAUDE_BIN
test.skip(!binary || process.platform !== 'win32', 'Requires the explicitly selected native Claude binary')
test('Claude launches with both views by default and keeps one native session across both views', async () => {
  const fixture = await claudeConversationFixture()
  let application: ElectronApplication | undefined
  try {
    const env = { ...fixture.env, ANTHROPIC_MODEL: 'claude-sonnet-4-6', NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(fixture.root, 'knowledge') }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${dirname(binary!)};${env[pathKey] ?? ''}`
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixture.root, 'profile')}`], env })
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedIntroducedLearning(page)
    await page.evaluate(async cwd => {
      const api = (window as any).electron
      await api.system.setLanguage('en')
      const workspace = await api.workspace.create({ name: 'Claude dual mode fixture', path: cwd })
      await api.workspace.load(workspace.id)
      await api.terminal.create({ id: 'claude-setup', workspaceId: workspace.id, cwd, preset: 'claude', shell: 'powershell' })
    }, fixture.cwd)
    const setupReplay = async () => (await page.evaluate(async () => (await (window as any).electron.terminal.replay('claude-setup')).data as string)).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    const key = (data: string) => page.evaluate(data => (window as any).electron.terminal.input('claude-setup', data), data)
    await expect.poll(setupReplay, { timeout: 20000 }).toContain('trust')
    await page.waitForTimeout(1200); await key('\x1b[B'); await page.waitForTimeout(200); await key('\r')
    await expect.poll(setupReplay).toContain('DoyouwanttousethisAPIkey')
    // The native key dialog ignores early navigation while mounting. Confirm
    // its persisted fixture-only choice before closing the setup terminal.
    await page.waitForTimeout(1500); await key('\x1b[A'); await page.waitForTimeout(200); await key('\r')
    await expect.poll(async () => JSON.parse(await readFile(join(fixture.config, '.claude.json'), 'utf8')).customApiKeyResponses?.approved ?? []).toContain('local-fixture-only')
    await expect.poll(setupReplay).toContain('forshortcuts')
    await page.evaluate(() => (window as any).electron.terminal.kill('claude-setup'))
    await page.reload()
    await page.locator('.ws').filter({ hasText: 'Claude dual mode fixture' }).first().click()
    await expect(page.getByRole('switch', { name: 'Conversation mode', exact: true })).toHaveCount(0)
    await page.getByTitle('Settings', { exact: true }).click()
    await page.getByRole('button', { name: 'Default view for new sessions', exact: true }).click()
    await page.getByRole('option', { name: 'Conversation', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Claude', exact: true }).click()
    const host = page.locator('[data-agent-session]')
    await expect(host).toBeVisible({ timeout: 30000 })
    const id = await host.getAttribute('data-agent-session')
    const state = () => page.evaluate(async id => (window as any).electron.terminal.conversation(id), id)
    await expect.poll(async () => (await state())?.connection, { timeout: 25000 }).toBe('ready')
    await expect(host.getByRole('combobox', { name: 'Message Claude' })).toBeFocused()
    expect((await state()).mode).toBe('conversation')
    await host.getByRole('button', { name: 'Terminal', exact: true }).click()
    const threadId = (await state()).threadId
    await expect.poll(async () => (await page.evaluate(async id => (await (window as any).electron.terminal.replay(id)).data as string, id)).replace(/\s/g, ''), { timeout: 15000 }).toContain('forshortcuts')
    await page.waitForTimeout(700)
    const native = host.locator('.xterm-helper-textarea')
    await native.focus(); await page.keyboard.type('CC_FIRST', { delay: 40 }); await page.keyboard.press('Enter')
    await expect.poll(async () => (await state()).items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length).toBe(1)
    await host.getByRole('button', { name: 'Conversation', exact: true }).click()
    const input = host.getByRole('combobox', { name: 'Message Claude' })
    await expect(input).toBeFocused()
    await expect(host.locator('.xterm')).toBeHidden()
    await expect.poll(async () => (await state()).models.length).toBeGreaterThan(0)
    const chosen = (await state()).models.find((model: any) => model.displayName === 'Sonnet')
    await input.fill('/model Sonnet')
    await host.getByRole('option').filter({ has: page.getByText(chosen.displayName, { exact: true }) }).click()
    await expect(input).toHaveValue('')
    await input.fill('/effort high')
    await host.getByRole('option', { name: 'High', exact: true }).click()
    await expect(input).toHaveValue('')
    await expect(host.getByRole('button', { name: 'Choose reasoning effort' })).toHaveText('High')
    expect(fixture.requests.filter(request => request.stream)).toHaveLength(1)
    await input.fill('CC_SECOND')
    await expect(host.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await input.press('Enter')
    await expect(host.getByLabel('Conversation history').getByText('First CC_SECOND final', { exact: true })).toBeVisible()
    await expect.poll(async () => (await state()).turnId).toBeNull()
    await host.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(native).toBeFocused()
    await page.keyboard.type('CC_THIRD', { delay: 40 }); await page.keyboard.press('Enter')
    await expect.poll(async () => (await state()).items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length).toBe(3)
    await host.getByRole('button', { name: 'Conversation', exact: true }).click()
    await expect(input).toBeFocused()
    expect((await state()).threadId).toBe(threadId)
    for (const marker of ['CC_SECOND', 'CC_THIRD']) expect(fixture.requests.find(request => request.marker === marker && request.stream)).toMatchObject({ model: chosen.model, effort: 'high' })
    expect((await state()).items.filter((item: any) => item.type === 'userMessage').map((item: any) => item.text)).toEqual(['CC_FIRST', 'CC_SECOND', 'CC_THIRD'])
    await mkdir('artifacts/claude-dual-mode', { recursive: true })
    await page.screenshot({ path: 'artifacts/claude-dual-mode/desktop.png' })
    await host.getByRole('button', { name: 'Choose model' }).click()
    await page.screenshot({ path: 'artifacts/claude-dual-mode/desktop-model-picker.png' })
    await page.keyboard.press('Escape')
    await host.getByRole('button', { name: 'Choose reasoning effort' }).click()
    await page.screenshot({ path: 'artifacts/claude-dual-mode/desktop-effort.png' })
    await page.keyboard.press('Escape')
    for (const marker of ['CC_PLAN_CREATE', 'CC_PLAN_PROGRESS']) {
      await input.fill(marker); await input.press('Enter')
      await expect(host.getByLabel('Conversation history').getByText(`First ${marker} final`, { exact: true })).toBeVisible()
      await expect.poll(async () => (await state()).turnId).toBeNull()
    }
    const plan = host.getByRole('region', { name: 'Execution plan', exact: true }).last()
    await expect(plan).toContainText('0 / 1 completed')
    await expect(plan).toContainText('Turn ended · unfinished steps remain')
    await plan.getByRole('button').click()
    await expect(plan.getByText('Verify native todo', { exact: true })).toBeVisible()
    await expect(plan.locator('[data-state="inProgress"]')).toHaveCount(1)
    await page.screenshot({ path: 'artifacts/claude-dual-mode/desktop-plan.png' })
    await input.fill('CC_PLAN_COMPLETE'); await input.press('Enter')
    await expect.poll(async () => (await state()).plans?.at(-1)?.steps[0]?.status).toBe('completed')
    await expect.poll(async () => (await state()).turnId).toBeNull()
    await expect(plan).toContainText('1 / 1 completed')
    expect((await state()).threadId).toBe(threadId)
    await writeFile('artifacts/claude-dual-mode/desktop.json', JSON.stringify({ state: await state(), requests: fixture.requests }, null, 2))
    await page.evaluate(id => (window as any).electron.terminal.kill(id), id)
    await expect.poll(() => state()).toBeNull()
  } catch (error) {
    const page = application?.windows()[0]
    if (page && !page.isClosed()) {
      await mkdir('artifacts/claude-dual-mode', { recursive: true })
      await page.screenshot({ path: 'artifacts/claude-dual-mode/desktop-failure.png' })
      await writeFile('artifacts/claude-dual-mode/desktop-failure.txt', await page.locator('body').innerText())
      await writeFile('artifacts/claude-dual-mode/desktop-failure-requests.json', JSON.stringify(fixture.requests, null, 2))
    }
    throw error
  } finally {
    await application?.close()
    await promisify(execFile)(binary!, ['daemon', 'stop', '--any'], { env: fixture.env, cwd: fixture.cwd, windowsHide: true, timeout: 10000 }).catch(() => {})
    await fixture.close()
  }
})
