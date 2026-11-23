import { expect, test, type Page } from '@playwright/test'
test.setTimeout(60_000)

type FixtureWindow = Window & { automationChatFixture: {
  state(): { loaded: boolean; resources: string[]; conversationId: string; messages: string[]; isStreaming: boolean; activeTool: string | null; companionToolId: string | null; superAgentTab: string | null; superAgentCollapsed: boolean; saveCount: number; topicCount: number };
  selectWorkspace(id: string | null): void; showGit(): void; showAutomations(): void; closeAutomations(): void; draft(): void; queuePreviousRunFocus(): void;
  makeSuperAgentAvailable(): void; enableSuperAgent(): void; hideSuperAgent(): void; closeSuperAgent(): void; send(text: string): void; finish(): void;
  requests: Array<{ islandChat?: true; agentMode?: string; workerBackend?: string; workspaceId?: string; workspaceResources: Array<{ workspaceId: string; agentSessionId: string }> }>;
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

test('manual automation browsing leaves Island collapsed until the eye is clicked', async ({ page }) => {
  await page.goto('/automation-chat.html')
  await expect.poll(async () => (await state(page)).loaded).toBe(true)
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.makeSuperAgentAvailable())
  const rail = page.locator('#right-tool-rail-automations')
  await rail.click()
  const panel = page.locator('.automation-panel')
  const eye = panel.getByRole('button', { name: 'Open Island', exact: true })
  const island = page.locator('.janus-island-shell')
  await expect(panel).toHaveAttribute('data-island-linked', 'false')
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
  const initial = await state(page)
  expect(initial).toMatchObject({ companionToolId: null, superAgentTab: null, saveCount: 0 })
  await panel.getByRole('button', { name: 'New card', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(panel).toHaveAttribute('data-island-linked', 'false')
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  await eye.click()
  await expect(panel).toHaveAttribute('data-island-linked', 'true')
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.keyboard.press('Escape')
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.mouse.click(10, 90)
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
  await expect(panel).toHaveAttribute('data-island-linked', 'true')
  await eye.click()
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.showGit())
  await expect.poll(async () => (await state(page)).companionToolId).toBeNull()
  await rail.click()
  await expect(eye).toBeEnabled()
  await expect(panel).toHaveAttribute('data-island-linked', 'false')
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
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
  await expect(panel).toHaveAttribute('data-island-linked', 'false')
  await expect.poll(async () => (await state(page)).companionToolId).toBeNull()
  expect(await state(page)).toMatchObject({ superAgentTab: 'superagent', superAgentCollapsed: true, saveCount: 0 })
  await eye.click()
  await expect(panel).toHaveAttribute('data-island-linked', 'true')
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
  await expect(island).toHaveAttribute('data-stage', 'collapsed')
  await expect(panel).toHaveAttribute('data-island-linked', 'false')
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

test('Island sends read-only ordinary turns even with a legacy SuperAgent preference and open tab', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('janus:superagent-view', JSON.stringify({ modeVersion: 1, agentMode: 'superagent' })))
  await page.goto('/automation-chat.html')
  await expect.poll(async () => (await state(page)).loaded).toBe(true)
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.enableSuperAgent())
  await page.locator('.janus-island').dblclick()
  await expect(page.locator('.janus-chat-input')).toBeVisible()
  await expect.poll(async () => (await state(page)).resources).toEqual(['workspace-1'])
  await page.evaluate(() => (window as FixtureWindow).automationChatFixture.selectWorkspace('workspace-2'))
  await send(page, '@Worker use Codex to change README.md')
  const request = () => page.evaluate(() => (window as FixtureWindow).automationChatFixture.requests[0])
  await expect.poll(request).toMatchObject({ islandChat: true, agentMode: 'ordinary', workspaceId: 'workspace-2', workspaceResources: [{ workspaceId: 'workspace-1' }] })
  expect((await request()).workerBackend).toBeUndefined()
  expect(await state(page)).toMatchObject({ topicCount: 0, superAgentTab: 'superagent' })
})
