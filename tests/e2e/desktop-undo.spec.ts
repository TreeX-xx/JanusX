import { expect, test } from '@playwright/test'

const pageErrors: string[] = []
test.beforeEach(({ page }) => { pageErrors.length = 0; page.on('pageerror', (error) => pageErrors.push(error.message)) })
test.afterEach(() => expect(pageErrors).toEqual([]))

test('managed undo previews a write and reverses it on confirm', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/project.html')
  await page.addStyleTag({ content: '.fixture-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; padding:8px; } [data-testid="main-chat"], [data-testid="project-panel"] { display:none; }' })
  const task = page.getByTestId('task')

  await task.getByRole('button', { name: 'Preview undo', exact: true }).click()
  await expect(task).toContainText('Undo candidate tx-1')
  await expect(task).toContainText('.agents/notes/a.md [reversible]')
  await task.getByRole('button', { name: 'Confirm undo', exact: true }).click()
  await expect(task).toContainText('restored 1 files')
  const counts = await page.evaluate(() => {
    const fixture = (window as any).projectFixture
    return { undoPreviews: fixture.undoPreviews, undoApplies: fixture.undoApplies }
  })
  expect(counts).toMatchObject({ undoPreviews: 1, undoApplies: 1 })
})
