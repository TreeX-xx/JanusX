import { expect, test } from '@playwright/test'

test('Island and the toolbox dismiss when the shell receives only click', async ({ page }) => {
  await page.goto('/?titlebar=1')
  const titlebar = page.locator('.titlebar-drag').first()
  const island = page.locator('.janus-island-shell')
  const toolbox = page.locator('button[data-id="tool-menu"]')
  const outside = page.locator('body')
  await expect(titlebar).toHaveCSS('-webkit-app-region', 'drag')

  await island.locator('.janus-island').dblclick()
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await expect(titlebar).toHaveCSS('-webkit-app-region', 'no-drag')
  await island.locator('.janus-chat-input').dispatchEvent('click', { detail: 1 })
  await expect(island).toHaveAttribute('data-stage', 'expanded')
  await outside.dispatchEvent('click', { detail: 1 })
  await expect(island).toHaveAttribute('data-stage', 'collapsed')

  await toolbox.click()
  await expect(toolbox).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('menu').dispatchEvent('click', { detail: 1 })
  await expect(toolbox).toHaveAttribute('aria-expanded', 'true')
  await outside.dispatchEvent('click', { detail: 1 })
  await expect(toolbox).toHaveAttribute('aria-expanded', 'false')
  await expect(titlebar).toHaveCSS('-webkit-app-region', 'drag')
})

test('model, effort and speed dismiss on click alone and preserve the draft', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation&ultrafast')
  const model = page.getByRole('button', { name: 'Choose model' })
  const input = page.getByRole('combobox', { name: 'Message Codex' })
  const picker = page.locator('[data-composer-options]')
  await input.fill('Keep my draft')
  await model.click()
  await page.getByRole('option', { name: /Fixture Deep/ }).click()
  for (const [kind, trigger] of [
    ['model', model],
    ['effort', page.getByRole('button', { name: 'Choose reasoning effort' })],
    ['speed', page.getByRole('button', { name: /Choose response speed/ })],
  ] as const) {
    await trigger.click()
    await expect(picker).toHaveAttribute('data-panel', kind)
    await picker.dispatchEvent('click', { detail: 1 })
    await expect(picker).toBeVisible()
    await input.dispatchEvent('click', { detail: 1 })
    await expect(picker).toHaveCount(0)
    await expect(input).toHaveText('Keep my draft')
  }
})
