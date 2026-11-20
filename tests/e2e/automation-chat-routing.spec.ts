import { expect, test, type Page } from '@playwright/test'
test.setTimeout(60_000)

type FixtureWindow = Window & { automationChatFixture: {
  state(): { loaded: boolean; resources: string[]; conversationId: string; messages: string[]; isStreaming: boolean; activeTool: string | null; companionToolId: string | null; superAgentTab: string | null; superAgentCollapsed: boolean; saveCount: number };
  selectWorkspace(id: string | null): void; showGit(): void; showAutomations(): void; closeAutomations(): void; draft(): void; queuePreviousRunFocus(): void;
  makeSuperAgentAvailable(): void; enableSuperAgent(): void; hideSuperAgent(): void; closeSuperAgent(): void; send(text: string): void; finish(): void;
  requests: Array<{ workspaceId?: string; workspaceResources: Array<{ workspaceId: string; agentSessionId: string }> }>;
} }
const state = (page: Page) => page.evaluate(() => (window as FixtureWindow).automationChatFixture.state())
async function open(page: Page, query = '') {
  await page.goto(`/automation-chat.html${query}`)
  await expect.poll(async () => (await state(page)).loaded).toBe(true)
  await page.getByTestId('open-island').click()
  await expect(page.locator('.janus-chat-input')).toBeVisible()
}
async function send(page: Page, text: string) {
  await page.locator('.janus-chat-input').fill(text)
  await page.locator('.janus-chat-input').press('Enter')
}

test('opening loads the selected workspace first and preserves the conversation', async ({ page }) => {
  await open(page)
  await expect.poll(async () => (await state(page)).resources).toEqual(['workspace-1'])
  const initial = await state(page)
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.selectWorkspace('workspace-2'))
  await page.getByTestId('open-island').click()
  await expect.poll(async () => (await state(page)).resources).toEqual(['workspace-2', 'workspace-1'])
  expect(await state(page)).toMatchObject({ conversationId: initial.conversationId, messages: initial.messages })
})

for (const width of [1280, 680]) {
  test(`an automation message switches tools and positions both surfaces at ${width}px before a model reply`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    await page.evaluate(() => (window as FixtureWindow).automationChatFixture.showGit())
    await expect.poll(async () => (await state(page)).activeTool).toBe('git')
    await send(page, '生成一个自动化流程，每一分钟提醒我检查一下手机，以通知的形式')
    const automation = page.locator('.automation-panel')
    const island = page.locator('.janus-island-shell')
    await expect(automation).toBeVisible()
    await expect(automation).toHaveAttribute('data-island-linked', 'true')
    await expect(island).toHaveAttribute('data-tool-companion', width === 1280 ? 'parallel' : 'stacked')
    await expect.poll(async () => {
      const main = (await island.boundingBox())!, tool = (await automation.boundingBox())!
      return main.x + main.width + 48 <= tool.x || main.y + main.height <= tool.y
    }).toBe(true)
    await expect.poll(async () => page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests.length)).toBe(1)
    expect(await page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests[0].workspaceResources[0])).toMatchObject({ workspaceId: 'workspace-1', agentSessionId: 'agent-workspace-1' })
    expect(await state(page)).toMatchObject({ activeTool: 'automations', saveCount: 0 })
    await page.screenshot({ path: `artifacts/automations/automatic-routing-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(automation).toHaveAttribute('data-island-linked', 'true')
    await expect(island).toHaveAttribute('data-stage', 'expanded')
  })
}

test('automations and its eye use Island when the SuperAgent tab is closed', async ({ page }) => {
  await page.goto('/automation-chat.html')
  await expect.poll(async () => (await state(page)).loaded).toBe(true)
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).automationChatFixture
    fixture.makeSuperAgentAvailable()
    fixture.showAutomations()
  })
  const panel = page.locator('.automation-panel')
  const eye = panel.getByRole('button', { name: 'Open Island', exact: true })
  const island = page.locator('.janus-island-shell')
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  const initial = await state(page)
  expect(initial).toMatchObject({ companionToolId: 'automations', superAgentTab: null, saveCount: 0 })
  await page.keyboard.press('Escape')
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.mouse.click(10, 90)
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
  await expect(panel).toHaveAttribute('data-island-linked', 'true')
  await eye.click()
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.showGit())
  await expect.poll(async () => (await state(page)).companionToolId).toBeNull()
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.showAutomations())
  await expect(eye).toBeEnabled()
  expect(await state(page)).toMatchObject({ conversationId: initial.conversationId, messages: initial.messages, superAgentTab: null, saveCount: 0 })
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.closeAutomations())
  await expect.poll(async () => (await state(page)).companionToolId).toBeNull()
})

test('only the eye reveals an existing SuperAgent tab and manual closure survives reload', async ({ page }) => {
  await page.goto('/automation-chat.html')
  await expect.poll(async () => (await state(page)).loaded).toBe(true)
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).automationChatFixture
    fixture.enableSuperAgent()
    fixture.hideSuperAgent()
    fixture.showAutomations()
  })
  const panel = page.locator('.automation-panel')
  const eye = panel.getByRole('button', { name: 'Super Agent', exact: true })
  const island = page.locator('.janus-island-shell')
  await expect.poll(async () => (await state(page)).companionToolId).toBe('automations')
  expect(await state(page)).toMatchObject({ superAgentTab: 'superagent', superAgentCollapsed: true, saveCount: 0 })
  await eye.click()
  expect(await state(page)).toMatchObject({ superAgentTab: 'superagent', superAgentCollapsed: false })
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.closeAutomations())
  await expect.poll(async () => (await state(page)).companionToolId).toBeNull()
  expect((await state(page)).superAgentTab).toBe('superagent')

  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).automationChatFixture
    fixture.showAutomations()
    fixture.closeSuperAgent()
  })
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await expect(panel.getByRole('button', { name: 'Open Island', exact: true })).toBeEnabled()
  expect((await state(page)).superAgentTab).toBeNull()

  await page.reload()
  await expect.poll(async () => (await state(page)).loaded).toBe(true)
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).automationChatFixture
    fixture.makeSuperAgentAvailable()
    fixture.showAutomations()
  })
  await panel.getByRole('button', { name: 'Open Island', exact: true }).click()
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  expect(await state(page)).toMatchObject({ superAgentTab: null, saveCount: 0 })
})

test('ordinary chat stays in place and a returned automation draft activates the panel', async ({ page }) => {
  await open(page)
  await send(page, 'Explain this function')
  await expect.poll(async () => page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests.length)).toBe(1)
  expect((await state(page)).activeTool).toBeNull()
  await expect(page.locator('.janus-island-shell')).not.toHaveAttribute('data-tool-companion')
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.queuePreviousRunFocus())
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.draft())
  await expect(page.locator('.automation-panel')).toHaveAttribute('data-island-linked', 'true')
  await expect(page.locator('.automation-panel').getByLabel('Task name', { exact: true })).toHaveValue('Proposed review')
  const scroll = page.locator('.automation-scroll')
  await scroll.evaluate(node => { node.scrollTop = node.scrollHeight })
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.draft())
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(0)
})

test('opening without a selected workspace does not invent a project', async ({ page }) => {
  await open(page, '?no-workspace=1')
  expect((await state(page)).resources).toEqual([])
  await send(page, 'Create an automation')
  await expect(page.locator('.automation-panel')).toHaveAttribute('data-island-linked', 'true')
  await expect.poll(async () => page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests.length)).toBe(1)
  expect(await page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests[0].workspaceResources)).toEqual([])
})

test('SuperAgent fixes each message and its tool scope to the selected workspace without manual attachment', async ({ page }) => {
  await open(page)
  const initial = await state(page)
  expect(initial.resources).toEqual(['workspace-1'])
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.enableSuperAgent())
  await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-stage', 'collapsed')
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).automationChatFixture
    fixture.selectWorkspace('workspace-2')
    fixture.send('Review this project')
    // Switch before the asynchronous agent session has finished opening.
    fixture.selectWorkspace('workspace-1')
  })
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests.length)).toBe(1)
  expect(await page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests[0])).toMatchObject({
    workspaceId: 'workspace-2',
    workspaceResources: [{ workspaceId: 'workspace-2', agentSessionId: 'agent-workspace-2' }],
  })
  for (const [workspaceId, count] of [['workspace-1', 2], [null, 3]] as const) {
    await page.evaluate(() => (window as FixtureWindow).automationChatFixture.finish())
    await expect.poll(async () => (await state(page)).isStreaming).toBe(false)
    await page.evaluate(id => {
      const fixture = (window as FixtureWindow).automationChatFixture
      fixture.selectWorkspace(id)
      fixture.send('Explain the current context')
    }, workspaceId)
    await expect.poll(() => page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests.length)).toBe(count)
    const request = await page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests.at(-1)!)
    expect(request.workspaceId).toBe(workspaceId ?? undefined)
    expect(request.workspaceResources.map(resource => resource.workspaceId)).toEqual(workspaceId ? [workspaceId] : [])
  }
  expect(await state(page)).toMatchObject({ conversationId: initial.conversationId, resources: initial.resources })
})
