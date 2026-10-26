import { expect, test } from '@playwright/test'

const pageErrors: string[] = []
test.beforeEach(({ page }) => { pageErrors.length = 0; page.on('pageerror', (error) => pageErrors.push(error.message)) })
test.afterEach(() => expect(pageErrors).toEqual([]))

test('external runner backflow hands over, takes over, and shows evidence rules', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/project.html')
  await page.addStyleTag({ content: '.fixture-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; padding:8px; } [data-testid="main-chat"], [data-testid="project-panel"] { display:none; }' })
  const task = page.getByTestId('task')

  await task.getByLabel('Allowed paths', { exact: true }).fill('src/')
  await task.getByLabel('AC-1', { exact: true }).fill('The value is 42')
  await task.getByLabel('Program', { exact: true }).fill('node')
  await task.getByLabel('Arguments', { exact: true }).fill('-e\nprocess.exit(0)')
  await task.getByLabel('Executor', { exact: true }).selectOption('external')
  await task.getByRole('button', { name: 'Adopt task', exact: true }).click()
  await task.getByRole('button', { name: 'Prepare run', exact: true }).click()
  await expect(task).toContainText('External run queued')
  await expect(task.getByRole('button', { name: 'Execute and verify', exact: true })).toBeDisabled()

  await task.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(task).toContainText('External terminal executing')
  await task.getByRole('button', { name: 'Write handoff', exact: true }).click()
  await expect(task).toContainText('External handoff')
  await expect(task).toContainText('Harness run handoff')
  await expect(task).toContainText('/harness note://')

  await task.getByLabel('Takeover reason', { exact: true }).fill('Terminal takes over')
  await task.getByRole('button', { name: 'Take over run', exact: true }).click()
  const counts = await page.evaluate(() => {
    const fixture = (window as any).projectFixture
    return { prepares: fixture.prepares, starts: fixture.starts, takeovers: fixture.takeovers }
  })
  expect(counts).toMatchObject({ prepares: 1, starts: 1, takeovers: 1 })
})
