import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { dirname, join, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { hookCliFixture } from '../helpers/hook-cli-fixture'
import { seedIntroducedLearning } from './desktop-test-env'

test.skip(!process.env.JANUSX_TEST_CODEX_BIN || process.platform !== 'win32', 'Requires the explicitly selected local Codex binary')
test('conversation-first startup completes folder and hook authorization in dialogs with real IPC', async () => {
  const fixture = await hookCliFixture()
  let application: ElectronApplication | undefined
  try {
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      '[analytics]', 'enabled=false', '[feedback]', 'enabled=false',
    ].join('\n'))
    const env = { ...fixture.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(fixture.root, 'knowledge') }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${dirname(process.env.JANUSX_TEST_CODEX_BIN!)};${env[pathKey] ?? ''}`
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixture.root, 'profile')}`], env })
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedIntroducedLearning(page)
    await page.evaluate(async cwd => {
      const api = (window as any).electron
      await api.system.setLanguage('en')
      localStorage.setItem('janusx-conversation-launch', JSON.stringify({ version: 1, state: { initialView: 'conversation' } }))
      const workspace = await api.workspace.create({ name: 'Startup dialog fixture', path: cwd })
      await api.workspace.load(workspace.id)
    }, fixture.cwd)
    await page.reload()
    await page.locator('.ws').filter({ hasText: 'Startup dialog fixture' }).first().click()
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    const host = page.locator('[data-agent-session]')
    await expect(host).toBeVisible()
    const trust = page.getByRole('region', { name: 'Trust this folder?' })
    await expect(trust).toBeVisible({ timeout: 25000 })
    await expect(host.locator('.xterm')).toBeHidden()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await host.getByRole('combobox').fill('Draft')
    await host.getByRole('combobox').press('Control+j')
    await expect(host.getByRole('combobox')).toHaveValue('Draft\n')
    await expect(host.getByRole('combobox')).toHaveAttribute('spellcheck', 'false')
    await trust.getByRole('button', { name: 'Cancel', exact: true }).click()
    await host.getByRole('combobox').fill('DESKTOP_STARTUP_DRAFT')
    await host.getByRole('button', { name: 'Continue setup' }).click()
    await trust.getByRole('button', { name: 'Trust and continue' }).click()
    const hooks = page.getByRole('region', { name: 'Allow these startup hooks?' })
    await expect(hooks).toBeVisible({ timeout: 20000 })
    await hooks.locator('summary').first().click()
    await expect(hooks.locator('pre').first()).toBeVisible()
    await page.screenshot({ path: 'artifacts/codex-startup/desktop-hooks-inline.png' })
    await hooks.getByRole('button', { name: 'Trust and continue' }).click()
    await expect(hooks).toHaveCount(0)
    const id = await host.getAttribute('data-agent-session')
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.connection, id), { timeout: 20000 }).toBe('ready')
    await expect(host.locator('.xterm')).toBeHidden()
    await expect(host.getByRole('combobox')).toHaveValue('DESKTOP_STARTUP_DRAFT')
    await host.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.items.some((item: any) => item.type === 'agentMessage' && item.status === 'completed'), id), { timeout: 20000 }).toBe(true)
    await page.screenshot({ path: 'artifacts/codex-startup/desktop-ready.png' })
  } finally { await application?.close(); await fixture.close() }
})

test('new dual-mode entry uses real preload, IPC, native TUI and one thread through view switches', async () => {
  const fixture = await hookCliFixture()
  const proxyRequests: string[] = []
  const proxy = createServer((req, res) => { proxyRequests.push(req.url ?? ''); res.writeHead(502).end() })
  proxy.on('connect', (req, socket) => { proxyRequests.push(req.url ?? ''); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`
  Object.assign(fixture.env, { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'existing.internal' })
  let application: ElectronApplication | undefined
  try {
    await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
      'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
      '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"', '[analytics]', 'enabled=false', '[feedback]', 'enabled=false',
    ].join('\n'))
    const env = { ...fixture.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(fixture.root, 'knowledge') }
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${dirname(process.env.JANUSX_TEST_CODEX_BIN!)};${env[pathKey] ?? ''}`
    application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixture.root, 'profile')}`], env })
    const page = await application.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await seedIntroducedLearning(page)
    await page.evaluate(async cwd => {
      const api = (window as any).electron
      await api.system.setLanguage('en')
      const workspace = await api.workspace.create({ name: 'Dual mode fixture', path: cwd })
      await api.workspace.load(workspace.id)
    }, fixture.cwd)
    await page.reload()
    await page.locator('.ws').filter({ hasText: 'Dual mode fixture' }).first().click()
    await expect(page.getByRole('switch', { name: 'Conversation mode', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    const host = page.locator('[data-agent-session]')
    await expect(host).toBeVisible()
    const id = await host.getAttribute('data-agent-session')
    const replay = () => page.evaluate(async id => (await (window as any).electron.terminal.replay(id)).data as string, id)
    await expect.poll(replay, { timeout: 25000 }).toContain('hooks are new or changed.')
    // Native review is exercised only for the generated hooks in this disposable home.
    await page.evaluate(id => (window as any).electron.terminal.input(id, '2\r'), id)
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.connection, id), { timeout: 20000 }).toBe('ready')
    await expect.poll(replay).toContain('state=idle')
    const native = host.locator('.xterm-helper-textarea')
    await native.focus(); await page.keyboard.type('DESKTOP_TERMINAL_FIRST', { delay: 30 }); await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length, id)).toBe(1)
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).turnId, id), { timeout: 20000 }).toBeNull()
    const thread = await page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).threadId, id)
    await host.getByRole('button', { name: 'Conversation', exact: true }).click()
    await expect(host.locator('.xterm')).toBeHidden()
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).models.length, id)).toBeGreaterThan(0)
    const chosenModel = await page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).models.find((model: any) => model.efforts.some((value: any) => value.effort === 'high')).model as string, id)
    await host.getByRole('combobox', { name: 'Message Codex' }).fill(`/model ${chosenModel}`)
    await host.getByRole('combobox', { name: 'Message Codex' }).press('Enter')
    await expect(host.getByRole('combobox', { name: 'Message Codex' })).toHaveValue('')
    await host.getByRole('combobox', { name: 'Message Codex' }).fill('/effort high')
    await host.getByRole('option', { name: 'High', exact: true }).click()
    await expect(host.getByRole('button', { name: 'Choose reasoning effort' })).toHaveText('High')
    await expect(host.getByRole('combobox', { name: 'Message Codex' })).toHaveValue('')
    await host.getByRole('combobox', { name: 'Message Codex' }).fill('DESKTOP_DIALOG_SECOND')
    await host.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length, id)).toBe(2)
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).turnId, id), { timeout: 20000 }).toBeNull()
    await expect(host.getByRole('combobox')).toHaveValue('')
    await host.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(host.locator('.xterm')).toBeVisible()
    await expect(native).toBeFocused()
    await native.focus(); await page.keyboard.type('DESKTOP_TERMINAL_THIRD', { delay: 30 }); await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length, id)).toBe(3)
    await host.getByRole('button', { name: 'Conversation', exact: true }).click()
    const snapshot = await page.evaluate(async id => (window as any).electron.terminal.conversation(id), id)
    expect(proxyRequests.some(target => target.startsWith('127.0.0.1:'))).toBe(false)
    expect(snapshot.threadId).toBe(thread)
    expect(snapshot).toMatchObject({ model: chosenModel, effort: 'high' })
    for (const marker of ['DESKTOP_DIALOG_SECOND', 'DESKTOP_TERMINAL_THIRD']) {
      expect(fixture.responseRequests.find(request => request.input.includes(marker))).toMatchObject({ model: chosenModel, effort: 'high' })
    }
    expect(snapshot.items.filter((item: any) => item.type === 'userMessage').map((item: any) => item.text)).toEqual(['DESKTOP_TERMINAL_FIRST', 'DESKTOP_DIALOG_SECOND', 'DESKTOP_TERMINAL_THIRD'])
    await expect(host.getByRole('button', { name: 'Conversation', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: 'artifacts/codex-dual-mode/desktop.png' })
    await host.getByRole('button', { name: 'Choose model', exact: true }).click()
    await expect(host.getByRole('listbox', { name: 'Model', exact: true })).toBeVisible()
    await page.screenshot({ path: 'artifacts/codex-dual-mode/desktop-model-picker.png' })
    await host.getByRole('combobox', { name: 'Search options' }).press('Escape')
    await host.getByRole('button', { name: 'Choose reasoning effort' }).click()
    await expect(host.getByRole('listbox', { name: 'Reasoning effort' })).toBeFocused()
    await page.screenshot({ path: 'artifacts/codex-dual-mode/desktop-effort-scale.png' })
    await page.evaluate(async id => (window as any).electron.terminal.kill(id), id)
    await expect.poll(() => page.evaluate(async id => (window as any).electron.terminal.conversation(id), id)).toBeNull()
  } catch (error) {
    const page = application?.windows()[0]
    if (page && !page.isClosed()) {
      await page.screenshot({ path: 'artifacts/codex-dual-mode/desktop-failure.png' })
      const state = await page.evaluate(async () => {
        const id = document.querySelector('[data-agent-session]')?.getAttribute('data-agent-session')
        return id ? { snapshot: await (window as any).electron.terminal.conversation(id), replay: await (window as any).electron.terminal.replay(id) } : null
      })
      await writeFile('artifacts/codex-dual-mode/desktop-failure.json', JSON.stringify({ ...state, proxyRequests, root: fixture.root }, null, 2))
    }
    throw error
  } finally {
    await application?.close(); await fixture.close()
    proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()))
  }
})
