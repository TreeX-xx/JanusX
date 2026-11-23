import { expect, test } from '@playwright/test'
import type { ConversationItem } from '../../src/shared/conversation-display'

test('Codex renders browser completion separately from the tool call and final answer', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const turnId = 'browser-turn'
  const title = 'Checked the "JanusX" session'
  const marker = `::browser-complete{title=${JSON.stringify(title)}}`
  const item = (id: string, text: string, fields: Partial<ConversationItem> = {}): ConversationItem => ({
    id, turnId, text, type: 'agentMessage', phase: 'commentary', status: 'completed', ...fields,
  })
  const tool = item('tool', 'Tool result', { type: 'mcpToolCall', activity: 'browser check' })
  const publish = (items: ConversationItem[]) => page.evaluate(({ turnId, items }) => {
    (window as any).codexFixture.progressSnapshot({ turnId, items })
  }, { turnId, items })
  const scroll = page.getByRole('region', { name: 'Conversation history', exact: true })
  const completion = scroll.locator('[data-browser-completion]')

  await publish([tool, item('completion', marker.slice(0, -2), { status: 'inProgress' })])
  const work = scroll.locator('.conversation-work-toggle')
  await expect(work).toContainText('browser check')
  await expect(scroll).not.toContainText('::browser-complete')
  await expect(completion).toHaveCount(0)

  await publish([tool, item('completion', marker), item('reply', 'The checks finished.', { phase: 'final_answer' })])
  await expect(completion).toHaveText(title)
  await expect(scroll.getByText('The checks finished.', { exact: true })).toBeVisible()
  await expect(scroll).not.toContainText('::browser-complete')
  await work.click()
  await expect(scroll.locator('.conversation-work details')).toHaveCount(1)

  await publish([
    item('final-example', marker, { phase: 'final_answer' }),
    item('code-example', `\`\`\`text\n${marker}\n\`\`\``),
    item('indented-code', `    ${marker}`),
    item('invalid', '::browser-complete{title="Invalid \\q"}'),
  ])
  await expect(scroll.locator('[data-side-item="final-example"]')).toContainText('::browser-complete')
  await expect(scroll.locator('[data-side-item="code-example"] code')).toHaveText(marker)
  await expect(scroll.locator('[data-side-item="indented-code"]')).toContainText('::browser-complete')
  await expect(scroll.locator('[data-side-item="invalid"]')).toContainText('::browser-complete')
  await expect(completion).toHaveCount(0)
})

test('Codex applies the same browser completion presentation to paged history', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.evaluate(() => {
    (window as any).codexFixture.workTruncated('history')
    const text = '::browser-complete{title="Checked an earlier browser page"}'
    window.electron.terminal.conversationHistory = async (_id, request) => ({
      type: 'page', threadId: request.threadId, olderCursor: null, newerCursor: null,
      items: [{ id: 'archive:browser', turnId: 'archive', type: 'agentMessage', phase: 'commentary', status: 'completed', text, textLength: text.length }],
    })
  })
  await page.getByRole('button', { name: 'Load earlier content', exact: true }).click()
  const history = page.locator('[data-conversation-history-browser]')
  await expect(history.locator('[data-browser-completion]')).toHaveText('Checked an earlier browser page')
  await expect(history).not.toContainText('::browser-complete')
})

test('native output uses row highlights and keeps a single plan per turn', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await expect(page.getByRole('button', { name: 'Conversation', exact: true })).toBeEnabled()
  await page.evaluate(() => (window as any).codexFixture.workPreview('start'))
  const work = page.locator('.conversation-work-toggle')
  await expect(work).toHaveAttribute('aria-expanded', 'false')
  await work.click()
  const active = page.locator('.conversation-work details[data-state="inProgress"]')
  await expect(active).toBeVisible()
  await expect(active).toHaveCSS('border-left-width', '0px')
  expect(await active.locator('summary').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await page.evaluate(() => { (window as any).codexFixture.plan(); (window as any).codexFixture.plan() })
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true }).last()
  const step = plan.locator('[data-current=true]')
  await expect(step).toHaveCSS('border-left-width', '0px')
  expect(await step.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await page.evaluate(() => (window as any).codexFixture.revisePlan())
  await expect(page.getByRole('region', { name: 'Execution plan', exact: true })).toHaveCount(1)
  await expect(page.locator('[data-plan-history]')).toHaveCount(0)
  for (const [theme, width] of [['dark', 1100], ['white', 390], ['planche', 760]] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.setViewportSize({ width, height: 850 })
    await expect(active.locator('summary .conversation-tool-target')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `artifacts/tool-presentation-unification-20261113/native-${theme}.png` })
  }
})
