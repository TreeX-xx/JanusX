import { expect, test } from '@playwright/test'

test('pasted screenshot and dropped reference survive failed delivery and explicit draft recovery', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex' })
  await input.fill('Inspect this screenshot')
  await input.evaluate(element => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('button', { name: 'Remove pasted.png' })).toBeVisible()
  await input.evaluate(element => {
    const data = new DataTransfer()
    data.setData('application/x-janusx-workspace-file', JSON.stringify({ type: 'file', name: 'app.ts', path: 'src/app.ts', workspacePath: 'C:/fixture' }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('button', { name: 'Remove app.ts' })).toBeVisible()
  await page.evaluate(() => (window as any).codexFixture.holdSend())
  await input.press('Enter')
  await page.evaluate(() => (window as any).codexFixture.releaseSend(true))
  await expect(page.getByRole('alert')).toHaveText('Error: Fixture send failed')
  await page.getByRole('button', { name: 'Edit / restore draft' }).click()
  await expect(input).toContainText('Inspect this screenshot')
  await expect(page.getByRole('button', { name: 'Remove pasted.png' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove app.ts' })).toBeVisible()
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends.length)).toBe(1)
})
