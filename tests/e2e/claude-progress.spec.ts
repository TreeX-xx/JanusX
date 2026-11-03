import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { ConversationItem, ConversationSnapshot } from '../../src/shared/conversation-display'

for (const theme of ['dark', 'light']) {
  test(`Claude activity changes while collapsed and preserves interleaved prose (${theme})`, async ({ page }) => {
    await page.clock.install()
    await page.goto(`/codex-conversation.html?initialView=conversation&engine=claude&theme=${theme}`)
    const startedAt = await page.evaluate(() => Date.now())
    const items: ConversationItem[] = [
      { id: 'user', turnId: 't', type: 'userMessage', text: 'Check progress reporting', status: 'completed' },
      { id: 'first', turnId: 't', type: 'agentMessage', text: 'I will inspect the event bridge.', status: 'completed' },
      { id: 'read', turnId: 't', type: 'commandExecution', activity: 'Read · src/main/terminal/claude-conversation.ts', text: 'Read\nNative file contents', status: 'inProgress', receivedAt: startedAt },
    ]
    const show = (done = false) => page.evaluate(snapshot => (window as any).codexFixture.progressSnapshot(snapshot), { items, turnId: done ? null : 't', turnStartedAt: startedAt })
    await show()
    const toggle = page.locator('.conversation-work-toggle').first()
    const activity = page.locator('.conversation-work-activity').first()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(activity).toContainText('Read · src/main/terminal/claude-conversation.ts')
    await page.clock.runFor(3000)
    await expect(activity.getByLabel('Run duration 0:03')).toBeVisible()
    await expect(page.getByText('Native file contents', { exact: false })).toHaveCount(0)
    await toggle.click()
    const original = await toggle.elementHandle()
    items[2].status = 'completed'
    items.push({ id: 'search', turnId: 't', type: 'commandExecution', activity: 'Grep · turn.step', text: 'Grep\nMatched event handler', status: 'inProgress', receivedAt: startedAt + 3000 })
    await show()
    await expect(activity).toContainText('Grep · turn.step')
    await expect(activity.getByLabel('Run duration 0:00')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await toggle.evaluate((element, previous) => element === previous, original)).toBe(true)
    await toggle.click()
    items[3].status = 'completed'
    items.push({ id: 'second', turnId: 't', type: 'agentMessage', text: 'The bridge is streaming. Checking the UI next.', status: 'completed' },
      { id: 'agent', turnId: 't', type: 'commandExecution', activity: 'Agent · Inspect frontend update behavior and narrow layouts', text: 'Agent', status: 'inProgress', receivedAt: startedAt + 3000 })
    await show()
    await expect(page.getByText('The bridge is streaming. Checking the UI next.', { exact: true })).toBeVisible()
    await expect(page.locator('.conversation-work-toggle')).toHaveCount(2)
    await expect(activity.getByLabel(/^Run duration/)).toHaveCount(0)
    await page.setViewportSize({ width: 380, height: 780 })
    await expect(page.locator('.conversation-work-activity').last()).toContainText('Agent · Inspect frontend')
    for (const row of await page.locator('.conversation-work-activity').all()) {
      expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: `artifacts/claude-progress/activity-${theme}.png` })
    items[5].status = 'completed'
    items.push({ id: 'final', turnId: 't', type: 'agentMessage', text: 'Both checks finished.', status: 'completed' })
    await show(true)
    await expect(page.getByText('Both checks finished.', { exact: true })).toBeVisible()
    await expect(page.locator('.conversation-work-activity').getByLabel(/^Run duration/)).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
}

test('Claude native snapshots display partial prose before final completion', async ({ page }) => {
  test.skip(!process.env.JANUSX_TEST_CLAUDE_PROGRESS, 'Run the native staged CLI test first and select its evidence file')
  const evidence: { snapshots: ConversationSnapshot[]; state: ConversationSnapshot } = JSON.parse(await readFile(process.env.JANUSX_TEST_CLAUDE_PROGRESS!, 'utf8'))
  await page.goto('/codex-conversation.html?initialView=conversation&engine=claude')
  for (const partial of ['Inspecting ', 'Found the first result. ', 'Both checks ']) {
    const snapshot = evidence.snapshots.find(snapshot => snapshot.turnId && snapshot.items.some(item => item.text === partial && item.status === 'inProgress'))!
    expect(snapshot).toBeTruthy()
    await page.evaluate(snapshot => (window as any).codexFixture.progressSnapshot(snapshot), snapshot)
    await expect(page.getByText(partial.trim(), { exact: true })).toBeVisible()
  }
  await page.evaluate(snapshot => (window as any).codexFixture.progressSnapshot(snapshot), evidence.state)
  await expect(page.getByText('Inspecting the first file.', { exact: true })).toBeVisible()
  await expect(page.getByText('Found the first result. Checking again.', { exact: true })).toBeVisible()
  await expect(page.getByText('Both checks finished.', { exact: true })).toBeVisible()
  await expect(page.locator('.conversation-work-toggle')).toHaveCount(2)
  await expect(page.locator('.conversation-work-toggle[aria-expanded="true"]')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/claude-progress/native-replay.png' })
})
