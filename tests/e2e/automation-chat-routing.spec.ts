import { expect, test, type Page } from '@playwright/test'
test.setTimeout(60_000)

type FixtureWindow = Window & { automationChatFixture: {
  state(): { loaded: boolean; resources: string[]; conversationId: string; messages: string[]; activeTool: string | null; saveCount: number };
  selectWorkspace(id: string): void; showGit(): void; draft(): void; queuePreviousRunFocus(): void;
  requests: Array<{ workspaceResources: Array<{ workspaceId: string; agentSessionId: string }> }>;
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
    await expect(automation).toHaveAttribute('data-island-linked', 'false')
  })
}

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
