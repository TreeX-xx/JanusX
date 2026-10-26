import { expect, test } from '@playwright/test'

const pageErrors: string[] = []
test.beforeEach(({ page }) => { pageErrors.length = 0; page.on('pageerror', (error) => pageErrors.push(error.message)) })
test.afterEach(() => expect(pageErrors).toEqual([]))

test('background threads activate with history and close only on confirm', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/project.html')
  await page.addStyleTag({ content: '.fixture-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; padding:8px; } [data-testid="main-chat"], [data-testid="project-panel"] { display:none; }' })
  const task = page.getByTestId('task')

  await task.getByLabel('Allowed paths', { exact: true }).fill('src/')
  await task.getByLabel('AC-1', { exact: true }).fill('The value is 42')
  await task.getByLabel('Program', { exact: true }).fill('node')
  await task.getByLabel('Arguments', { exact: true }).fill('-e\nprocess.exit(0)')
  await task.getByRole('button', { name: 'Adopt task', exact: true }).click()
  await task.getByRole('button', { name: 'Prepare run', exact: true }).click()
  await expect(task).toContainText('no thread record')

  await task.getByRole('button', { name: 'Start', exact: true }).click()
  await task.getByRole('button', { name: 'Activate', exact: true }).click()
  await expect(task).toContainText('Thread run-1')
  await expect(task).toContainText('p/m')
  await expect(task).toContainText('attempt 1 approved')

  await task.getByRole('button', { name: 'Close thread', exact: true }).click()
  await expect(task).toContainText('0 receipts exist')
  await task.getByRole('button', { name: 'Confirm close', exact: true }).click()
  await expect(task).toContainText('Thread run-1 closed.')
  await expect(task).toContainText('no thread record')
  expect(await page.evaluate(() => (window as any).projectFixture.threadCloses)).toBe(1)
})
