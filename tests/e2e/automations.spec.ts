import { expect, test, type Page } from '@playwright/test'
import { dailyReviewTemplate, reminderTemplate, type AutomationDraft, type AutomationsAPI } from '../../src/shared/automations'

const group = (page: Page, name: string) => page.locator('.automation-group').filter({ has: page.locator('.automation-card-title').filter({ hasText: name }) })
const task = (page: Page, name: string) => page.locator('.automation-task-card').filter({ has: page.getByRole('button', { name, exact: true }) })
async function createCard(page: Page, name = 'Daily routines') {
  await page.getByRole('button', { name: 'New card', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Card name', { exact: true }).fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(group(page, name)).toBeVisible()
}
async function addReminder(page: Page, name: string, interval: number, card = 'Daily routines') {
  await group(page, card).getByRole('button', { name: 'Add task', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save task', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Interval reminder', exact: true }).click()
  await page.getByLabel('Task name', { exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'Notification message', exact: true }).fill(`${name} message`)
  await page.getByLabel('Interval (minutes)', { exact: true }).fill(String(interval))
  await page.getByRole('button', { name: 'Save and enable', exact: true }).click()
  await expect(task(page, name)).toBeVisible()
}
test.beforeEach(async ({ page }) => { await page.goto('/automations.html?lang=en'); await expect(page.getByRole('button', { name: 'New card', exact: true })).toBeVisible() })

test('a card contains independently editable, scheduled, enabled and runnable tasks', async ({ page }) => {
  await createCard(page); await addReminder(page, 'Phone', 1); await addReminder(page, 'Stretch', 30)
  await expect(page.locator('.automation-group')).toHaveCount(1); await expect(page.locator('.automation-task-card')).toHaveCount(2)
  await task(page, 'Phone').getByRole('button', { name: 'Edit task', exact: true }).click()
  await expect(group(page, 'Daily routines').locator('.automation-editor')).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveCount(0)
  await page.getByLabel('Interval (minutes)', { exact: true }).fill('5')
  await page.getByRole('textbox', { name: 'Notification message', exact: true }).fill('Updated phone')
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  await task(page, 'Phone').getByRole('switch').click()
  await expect(task(page, 'Phone').getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(task(page, 'Stretch').getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  const definitions = await page.evaluate(() => window.electron.automations.list())
  expect(definitions.map(item => [item.name, item.intervalMinutes, item.enabled])).toEqual(expect.arrayContaining([['Phone', 5, false], ['Stretch', 30, true]]))
  await task(page, 'Phone').getByRole('button', { name: 'Run now', exact: true }).click()
  await task(page, 'Phone').getByRole('button', { name: 'Cancel run', exact: true }).click()
  await expect(task(page, 'Phone').locator('.automation-report')).toContainText('Cancelled')
  const other = definitions.find(item => item.name === 'Stretch')!
  expect(await page.evaluate(id => window.electron.automations.history(id), other.id)).toEqual([])
  await group(page, 'Daily routines').getByRole('button', { name: 'Rename card', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Card name', { exact: true }).fill('Personal')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(group(page, 'Personal').locator('.automation-task-card')).toHaveCount(2)
})

test('task removal keeps its sibling and empty card; deleting a card removes all children', async ({ page }) => {
  await createCard(page); await addReminder(page, 'Delete', 1); await addReminder(page, 'Keep', 10)
  await task(page, 'Delete').getByRole('button', { name: 'Run now', exact: true }).click()
  await task(page, 'Delete').getByRole('button', { name: 'Delete task', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(task(page, 'Delete').getByRole('button', { name: 'Cancel run', exact: true })).toBeVisible()
  await task(page, 'Delete').getByRole('button', { name: 'Delete task', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop and delete', exact: true }).click()
  await expect(page.locator('.automation-task-card')).toHaveCount(1)
  await expect(task(page, 'Keep')).toBeVisible()
  await task(page, 'Keep').getByRole('button', { name: 'Delete task', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete task', exact: true }).click()
  await expect(page.locator('.automation-task-card')).toHaveCount(0); await expect(page.locator('.automation-group')).toHaveCount(1)
  await addReminder(page, 'Again', 3); await addReminder(page, 'Also', 4)
  await createCard(page, 'Separate')
  await group(page, 'Daily routines').getByRole('button', { name: 'Delete card', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete card', exact: true }).click()
  await expect(page.locator('.automation-task-card')).toHaveCount(0); await expect(group(page, 'Separate')).toBeVisible()
})

test('editing stays in its card, survives remount and cancellation, and chat can choose an existing card', async ({ page }) => {
  await createCard(page); await addReminder(page, 'Existing', 5)
  await task(page, 'Existing').getByRole('button', { name: 'Edit task', exact: true }).click()
  await page.getByRole('textbox', { name: 'Notification message', exact: true }).fill('Unsaved')
  await page.getByRole('button', { name: 'Toggle panel' }).click(); await page.getByRole('button', { name: 'Toggle panel' }).click()
  await expect(group(page, 'Daily routines').getByRole('textbox', { name: 'Notification message', exact: true })).toHaveValue('Unsaved')
  await page.locator('.automation-editor').getByRole('button', { name: 'Cancel', exact: true }).click()
  await task(page, 'Existing').getByRole('button', { name: 'Edit task', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Notification message', exact: true })).toHaveValue('Existing message')
  await page.getByRole('button', { name: 'Receive chat draft' }).click()
  await expect(page.locator('.automation-editor')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Add to card', exact: true }).selectOption({ label: 'Daily routines' })
  await expect(group(page, 'Daily routines').locator('.automation-editor')).toHaveCount(1)
  await page.getByLabel('Task name', { exact: true }).fill('Review')
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(page.locator('.automation-group')).toHaveCount(1); await expect(group(page, 'Daily routines').locator('.automation-task-card')).toHaveCount(2)
})

test('child edits invalidate an older group deletion confirmation', async ({ page }) => {
  await createCard(page); await addReminder(page, 'Original', 1)
  await group(page, 'Daily routines').getByRole('button', { name: 'Delete card', exact: true }).click()
  await page.evaluate(async () => {
    const api = window.electron.automations, { id, revision, root: _root, createdAt: _created, nextRunAt: _next, ...input } = (await api.list())[0]
    await api.save({ ...input, name: 'Updated elsewhere' }, id, revision)
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Delete card', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed'); await expect(task(page, 'Updated elsewhere')).toBeVisible()
})

test('a newer chat draft survives an older pending save', async ({ page }) => {
  await createCard(page); await addReminder(page, 'Old', 1)
  await task(page, 'Old').getByRole('button', { name: 'Edit task', exact: true }).click()
  await page.evaluate(() => {
    const host = window as unknown as { electron: { automations: AutomationsAPI }; releaseSave(): void }
    const original = host.electron.automations.save
    host.electron.automations.save = async (...args) => { await new Promise<void>(resolve => { host.releaseSave = resolve }); return original(...args) }
  })
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  await page.evaluate(input => {
    const host = window as unknown as { automationFixture: { receiveDraft(draft: AutomationDraft): void }; releaseSave(): void }
    host.automationFixture.receiveDraft({ input }); host.releaseSave()
  }, { ...reminderTemplate('New proposal'), name: 'Newest draft' })
  await expect(page.getByLabel('Task name', { exact: true })).toHaveValue('Newest draft')
  await expect(page.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled()
})

test('review execution steps can be added, reordered and removed without changing sibling tasks', async ({ page }) => {
  await createCard(page); await addReminder(page, 'Keep', 10)
  await group(page, 'Daily routines').getByRole('button', { name: 'Add task', exact: true }).click()
  await page.getByRole('button', { name: 'Daily review template', exact: true }).click()
  await page.getByLabel('Task name', { exact: true }).fill('Review')
  await page.getByRole('button', { name: 'Add whitespace check', exact: true }).click()
  await expect(page.locator('.automation-task')).toHaveCount(4)
  await page.getByRole('button', { name: 'Move step up', exact: true }).last().click()
  await expect(page.locator('.automation-task').nth(1)).toContainText('Static check')
  await page.getByRole('button', { name: 'Remove step', exact: true }).first().click()
  await page.getByRole('button', { name: 'Preview range', exact: true }).click()
  await expect(page.locator('.automation-preview')).toContainText('example.ts')
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  const definitions = await page.evaluate(() => window.electron.automations.list())
  expect(definitions.find(item => item.name === 'Review')?.tasks.map(step => step.kind)).toEqual(dailyReviewTemplate().tasks.map(step => step.kind))
  expect(definitions.find(item => item.name === 'Keep')).toMatchObject({ intervalMinutes: 10, tasks: [{ message: 'Keep message' }] })
})

for (const theme of ['dark', 'planche']) for (const width of [300, 420]) test(`task cards and inline editor fit ${width}px in ${theme}`, async ({ page }) => {
  await page.goto(`/automations.html?lang=en&theme=${theme}&width=${width}`)
  await createCard(page, 'Daily routines'); await addReminder(page, 'A long task name with useful information', 5)
  await addReminder(page, 'Second task', 30)
  const panel = page.locator('.automation-panel')
  const overflow = () => panel.evaluate(node => [node, ...node.querySelectorAll('.automation-scroll,.automation-group,.automation-task-card,.automation-editor,.automation-task')].some(element => element.scrollWidth > element.clientWidth + 1))
  expect(await overflow()).toBe(false)
  await page.screenshot({ path: test.info().outputPath(`tasks-${theme}-${width}.png`) })
  await task(page, 'Second task').getByRole('button', { name: 'Edit task', exact: true }).click()
  await page.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('weekly')
  await expect(page.getByRole('combobox', { name: 'Day', exact: true })).toBeVisible()
  expect(await overflow()).toBe(false)
  await page.screenshot({ path: test.info().outputPath(`editor-${theme}-${width}.png`) })
})
