import { test, expect } from '@playwright/test'

test('Claude background completion restores controls and a new send clears an earlier stop error', async ({ page }) => {
  await page.goto('/codex-conversation.html?engine=claude&initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Claude', exact: true })
  await input.fill('Start background work'); await input.press('Enter')
  await page.evaluate(() => {
    const fixture = (window as any).codexFixture
    fixture.backgroundTask()
    const terminal = (window as any).electron.terminal
    const command = terminal.conversationCommand
    fixture.restoreCommand = () => { terminal.conversationCommand = command }
    terminal.conversationCommand = async (id: string, value: { type: string }) => {
      if (value.type === 'interrupt') throw new Error("Error invoking remote method 'terminal:conversation-command': Error: <tool_use_error>No task found with ID: bjcvnfu29</tool_use_error>")
      return command(id, value)
    }
  })
  await page.getByRole('button', { name: 'Stop response', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No task found with ID: bjcvnfu29')
  await input.fill('Continue after completion'); await input.press('Enter')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Start background work', 'Continue after completion'])
  // Deliver the same idle snapshot the controller publishes after task settlement.
  await page.evaluate(async () => {
    const terminal = (window as any).electron.terminal
    const fixture = (window as any).codexFixture
    fixture.restoreCommand()
    await terminal.conversationCommand('fixture', { type: 'interrupt' })
    fixture.finish()
  })
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0)
  await expect(page.getByText('Thinking…', { exact: true })).toHaveCount(0)
  await input.fill('Next task')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
})
