import { expect, test } from '@playwright/test'

const pageErrors: string[] = []
test.beforeEach(({ page }) => { pageErrors.length = 0; page.on('pageerror', (error) => pageErrors.push(error.message)) })
test.afterEach(() => expect(pageErrors).toEqual([]))

test('independent review audits, repair re-opens, and finish completes', async ({ page }) => {
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
  await task.getByRole('button', { name: 'Start', exact: true }).click()

  await task.getByLabel('Reviewer', { exact: true }).fill('evaluator')
  await task.getByLabel('Reviewer provider', { exact: true }).selectOption('p')
  await task.getByLabel('Reviewer model', { exact: true }).selectOption('model-b')
  await task.getByRole('button', { name: 'Independent review', exact: true }).click()
  await expect(task).toContainText('Review verdict needs-fix')

  await task.getByLabel('Failure summary', { exact: true }).fill('Flaky check, retry once.')
  await task.getByRole('button', { name: 'Repair', exact: true }).click()
  await expect(task).toContainText('attempt 2')
  await expect(task).toContainText('repair budget 1/1')

  await task.getByRole('button', { name: 'Execute and verify', exact: true }).click()
  await expect(task).toContainText('Receipt receipt-1')
  await expect(task.getByRole('button', { name: 'Check closeout', exact: true })).toBeEnabled()

  const counts = await page.evaluate(() => {
    const fixture = (window as any).projectFixture
    return { reviews: fixture.reviews, repairs: fixture.repairs, finishes: fixture.finishes }
  })
  expect(counts).toMatchObject({ reviews: 1, repairs: 1, finishes: 0 })
})
