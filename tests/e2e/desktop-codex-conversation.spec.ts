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
    await expect(host.getByRole('combobox', { name: 'Message Codex' })).toHaveText('')
    await host.getByRole('combobox', { name: 'Message Codex' }).fill('/effort high')
    await host.getByRole('option', { name: 'High', exact: true }).click()
    await expect(host.getByRole('button', { name: 'Choose reasoning effort' })).toHaveText('High')
    await expect(host.getByRole('combobox', { name: 'Message Codex' })).toHaveText('')
    await host.getByRole('combobox', { name: 'Message Codex' }).fill('DESKTOP_DIALOG_SECOND')
    await host.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length, id)).toBe(2)
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).turnId, id), { timeout: 20000 }).toBeNull()
    await expect(host.getByRole('combobox')).toHaveText('')
    await host.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(host.locator('.xterm')).toBeVisible()
    await expect(native).toBeFocused()
    await native.focus(); await page.keyboard.type('DESKTOP_TERMINAL_THIRD', { delay: 30 }); await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id))?.items.filter((item: any) => item.type === 'agentMessage' && item.status === 'completed').length, id)).toBe(3)
    await expect.poll(() => page.evaluate(async id => (await (window as any).electron.terminal.conversation(id)).turnId, id), { timeout: 20000 }).toBeNull()
    await host.getByRole('button', { name: 'Conversation', exact: true }).click()
    const snapshot = await page.evaluate(async id => (window as any).electron.terminal.conversation(id), id)
    expect(proxyRequests.some(target => target.startsWith('127.0.0.1:'))).toBe(false)
    expect(snapshot.threadId).toBe(thread)
    const originals = await page.evaluate(async id => {
      const api = (window as any).electron.terminal, current = await api.conversation(id)
      const history = await api.conversationHistory(id, { type: 'page', threadId: current.threadId, beforeItemId: current.items[0].id })
      const first = history.items.find((item: any) => item.type === 'userMessage')
      const text = await api.conversationHistory(id, { type: 'text', threadId: current.threadId, turnId: first.turnId, itemId: first.id, offset: 0 })
      return { inputs: history.items.filter((item: any) => item.type === 'userMessage').map((item: any) => item.text), text: text.text,
        unchanged: JSON.stringify(current) === JSON.stringify(await api.conversation(id)) }
    }, id)
    expect(originals).toEqual({ inputs: ['DESKTOP_TERMINAL_FIRST', 'DESKTOP_DIALOG_SECOND', 'DESKTOP_TERMINAL_THIRD'], text: 'DESKTOP_TERMINAL_FIRST', unchanged: true })
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

for (const control of ['Escape', 'Control+C', 'Stop response'] as const) {
  test(`Codex terminal status recovers after ${control}`, async () => {
    test.setTimeout(150_000)
    const dual = control === 'Stop response'
    const fixture = await hookCliFixture({ codexStatusProbe: true })
    let application: ElectronApplication | undefined
    try {
      await writeFile(join(fixture.env.CODEX_HOME!, 'config.toml'), [
        'model="probe"', 'model_provider="local"', 'check_for_update_on_startup=false',
        '[model_providers.local]', 'name="Local fixture"', `base_url="${fixture.url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false', 'request_max_retries=0', 'stream_max_retries=0',
        `[projects.${JSON.stringify(fixture.cwd)}]`, 'trust_level="trusted"',
      ].join('\n'))
      const env = { ...fixture.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '', JANUSX_KNOWLEDGE_ROOT: join(fixture.root, 'knowledge') }
      const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
      env[pathKey] = `${dirname(process.env.JANUSX_TEST_CODEX_BIN!)};${env[pathKey] ?? ''}`
      application = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(fixture.root, 'profile')}`], env })
      const page = await application.firstWindow()
      await seedIntroducedLearning(page)
      await page.evaluate(async cwd => {
        await window.electron.system.setLanguage('en')
        const ws = await window.electron.workspace.create({ name: 'Status fixture', path: cwd })
        await window.electron.workspace.load(ws.id)
      }, fixture.cwd)
      await page.reload()
      await page.locator('.ws').filter({ hasText: 'Status fixture' }).first().click()
      const id = 'status-probe'
      await page.evaluate(async ({ cwd, id, dual }) => {
        const ws = await window.electron.workspace.list()
        const statuses: string[] = []
        const outcomes: string[] = []
        Object.assign(window, { probeStatuses: statuses, probeOutcomes: outcomes })
        window.electron.agent.onHookEvent(event => {
          if (event.terminalId === id && ['interrupted', 'completed', 'failed'].includes(event.type)) outcomes.push(event.type)
        })
        window.electron.terminal.onStatus(event => { if (event.id === id) statuses.push(event.status) })
        await window.electron.terminal.create({ cwd, id, workspaceId: ws.find(w => w.path === cwd)!.id, shell: 'powershell.exe',
          preset: 'codex', conversationEnabled: dual, extraArgs: dual ? undefined : ['STATUS_HOLD Please explain Request failed with status code 503'], cols: 120, rows: 38 })
      }, { cwd: fixture.cwd, id, dual })
      const replay = () => page.evaluate(async id => (await window.electron.terminal.replay(id)).data, id)
      const input = (data: string) => page.evaluate(({ id, data }) => window.electron.terminal.input(id, data), { id, data })
      const statuses = () => page.evaluate(() => (window as unknown as { probeStatuses: string[] }).probeStatuses)
      await expect.poll(replay, { timeout: 25_000 }).toContain('hooks are new or changed.')
      await input('2\r')
      if (dual) {
        await expect.poll(() => page.evaluate(async id => (await window.electron.terminal.conversation(id))?.connection, id)).toBe('ready')
        await input('\x1b[200~STATUS_HOLD Please explain Request failed with status code 503\x1b[201~')
        await expect.poll(replay).toContain('503')
        await input('\r')
      }
      await expect.poll(() => fixture.responseRequests.some(request => request.input.includes('STATUS_HOLD')), { timeout: 20_000 }).toBe(true)
      if (dual) {
        const host = page.locator(`[data-agent-session="${id}"]`)
        await host.getByRole('button', { name: 'Conversation', exact: true }).click()
        await host.getByRole('button', { name: 'Stop response', exact: true }).click()
      } else await input(control === 'Escape' ? '\x1b' : '\x03')
      await expect.poll(async () => (await statuses()).at(-1), { timeout: 25_000 }).toBe('wait')
      await expect(page.locator('.term-status-ring--idle:visible').first()).toBeVisible()
      if (dual) {
        const host = page.locator(`[data-agent-session="${id}"]`)
        await host.getByRole('combobox').fill('Explain Request failed with status code 503 again')
        expect((await statuses()).at(-1)).toBe('wait')
        await host.getByRole('button', { name: 'Send', exact: true }).click()
      } else {
        await input('\x1b[200~Explain Request failed with status code 503 again\x1b[201~')
        await expect.poll(replay).toContain('again')
        expect((await statuses()).at(-1)).toBe('wait')
        await input('\r')
      }
      await expect.poll(async () => (await statuses()).filter(s => s === 'running' || s === 'degraded' || s === 'wait').slice(-4),
        { timeout: 20_000 }).toEqual(['running', 'wait', 'running', 'wait'])
      expect(await statuses()).not.toContain('degraded')
      const outcomes = () => page.evaluate(() => (window as unknown as { probeOutcomes: string[] }).probeOutcomes)
      await expect.poll(outcomes).toEqual(['interrupted', 'completed'])
      if (control === 'Escape') {
        await expect.poll(replay).toContain('state=done:app=codex')
        for (const marker of ['STATUS_FAIL_FIRST', 'STATUS_FAIL_SECOND']) {
          await input(`\x1b[200~${marker}\x1b[201~`)
          await expect.poll(replay).toContain(marker)
          await input('\r')
          await expect.poll(async () => (await statuses()).filter(s => s === 'degraded').length, { timeout: 25_000 })
            .toBe(marker === 'STATUS_FAIL_FIRST' ? 1 : 2)
        }
        await expect(page.locator('.term-status-ring--degraded:visible').first()).toBeVisible()
        await expect.poll(outcomes).toEqual(['interrupted', 'completed', 'failed', 'failed'])
      }
    } catch (error) {
      const page = application?.windows()[0]
      if (page) console.error('Codex status probe:', await page.evaluate(async () => ({
        statuses: (window as any).probeStatuses,
        screen: (await window.electron.terminal.replay('status-probe')).data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-1800),
      })).catch(() => null))
      throw error
    } finally { await application?.close(); await fixture.close() }
  })
}
