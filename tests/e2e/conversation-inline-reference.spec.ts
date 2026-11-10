import { test, expect, type Locator } from '@playwright/test'
import { PNG_PIXEL } from '../helpers/image-fixture'

async function dropFile(input: Locator, offset: number, name: string) {
  await input.evaluate((el, { offset, name }) => {
    const range = document.createRange(); range.setStart(el.firstChild!, offset); range.collapse(true)
    const box = range.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-janusx-workspace-file', JSON.stringify({ workspacePath: 'C:/fixture', path: name, name, type: 'file' }))
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: box.x, clientY: box.y + 5, dataTransfer }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: box.x, clientY: box.y + 5, dataTransfer }))
  }, { offset, name })
}

for (const method of ['paste', 'drop', 'picker']) test(`${method} imports keep their insertion point while typing continues elsewhere`, async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Compare  then explain.')
  await input.evaluate((el, method) => {
    const original = window.electron.file.importConversationAttachment
    window.electron.file.importConversationAttachment = async (...args) => {
      await new Promise<void>(resolve => { (window as any).finishImport = resolve })
      return original(...args)
    }
    const range = document.createRange(); range.setStart(el.firstChild!, 8); range.collapse(true)
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    const data = new DataTransfer(); data.items.add(new File(['context'], 'old.ts', { type: 'text/plain' }))
    if (method === 'paste') el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    if (method === 'drop') {
      const box = range.getBoundingClientRect()
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.x, clientY: box.y + 5 }))
    }
  }, method)
  if (method === 'picker') await page.locator('input[type=file]').setInputFiles({ name: 'old.ts', mimeType: 'text/plain', buffer: Buffer.from('context') })
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishImport)).toBe('function')
  await input.press('Control+End')
  await input.pressSequentially(' More detail.')
  await page.evaluate(() => (window as any).finishImport())
  await expect(input).toHaveText('Compare old.ts×  then explain. More detail.')
  const chip = input.locator('[data-reference-id]')
  const chipBox = (await chip.boundingBox())!
  const textTop = await input.evaluate(el => {
    const range = document.createRange(); range.setStart(el.firstChild!, 0); range.setEnd(el.firstChild!, 7)
    return range.getBoundingClientRect().top
  })
  expect(Math.abs(chipBox.y - textTop)).toBeLessThan(8)
  if (method === 'drop') await page.screenshot({ path: 'artifacts/conversation-inline-reference/inline-composer.png' })
  await input.press('Enter')
  await expect(page.locator('[data-user-message] [data-prompt-reference]')).toHaveText('old.ts')
  await expect(page.locator('[data-user-message]')).toContainText('Compare old.ts  then explain. More detail.')
  if (method === 'drop') await page.screenshot({ path: 'artifacts/conversation-inline-reference/inline-message.png' })
})

test('multiple imports keep file order and follow edits before the insertion point', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Compare  then explain.')
  await input.evaluate(el => {
    const original = window.electron.file.importConversationAttachment
    window.electron.file.importConversationAttachment = async (...args) => {
      if (args[0] === 'old.ts') await new Promise<void>(resolve => { (window as any).finishImport = resolve })
      return original(...args)
    }
    const range = document.createRange(); range.setStart(el.firstChild!, 8); range.collapse(true)
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    const data = new DataTransfer()
    for (const name of ['old.ts', 'new.ts']) data.items.add(new File(['context'], name, { type: 'text/plain' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishImport)).toBe('function')
  await input.press('Control+Home')
  await input.pressSequentially('Please ')
  await page.evaluate(() => (window as any).finishImport())
  await expect(input).toHaveText('Please Compare old.ts× new.ts×  then explain.')
  await input.press('Control+z')
  await expect(input.locator('[data-reference-id]')).toHaveCount(0)
  await input.press('Control+y')
  await expect(input.locator('[data-reference-id]')).toHaveCount(2)
})

test('message references handle quoted Windows paths and preserve literal examples', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  const path = 'C:\\workspace\\quoted "name".ts'
  const prompt = `Compare file: ${JSON.stringify(path)} with directory: "/workspace/src/". Example file: "relative.ts".`
  await input.fill(prompt)
  await input.press('Enter')
  const message = page.locator('[data-user-message]')
  await expect(message.locator('[data-prompt-reference]')).toHaveText(['quoted "name".ts', 'src'])
  await expect(message).toContainText('Example file: "relative.ts".')
  await expect(message.locator('[data-prompt-reference]').first()).toHaveAttribute('title', path)
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual([prompt])
})

test('long reference names stay compact and removable in a narrow composer', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 720 })
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Review ')
  const name = 'long-file-name-'.repeat(12) + '.ts'
  await dropFile(input, 7, name)
  const chip = input.locator('[data-reference-id]')
  expect((await chip.boundingBox())!.width).toBeLessThanOrEqual(242)
  const remove = input.getByRole('button', { name: `Remove ${name}`, exact: true })
  await expect(remove).toBeInViewport()
  expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/conversation-inline-reference/compact-narrow.png' })
  await remove.click()
  await expect(input).toHaveText('Review  ')
})

test('inserts references at the drop caret, supports undo and preserves order after remount and send', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Compare  then explain.')
  await dropFile(input, 8, 'old.ts')
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await expect(input).toContainText('Compare old.ts×  then explain.')
  await input.locator('[data-reference-id]').evaluate(chip => {
    const range = document.createRange(); range.setStartAfter(chip); range.collapse(true)
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  })
  await input.press('Backspace')
  await expect(input.locator('[data-reference-id]')).toHaveCount(0)
  await input.press('Control+z')
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await input.getByRole('button', { name: 'Remove old.ts' }).click()
  await expect(input.locator('[data-reference-id]')).toHaveCount(0)
  await input.press('Control+z')
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Remount', exact: true }).click()
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['Compare file: "C:/fixture/old.ts"  then explain.'])
  await expect(input).toHaveText('')
})

test('plain paste stays text and composition does not submit or replace the editor', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Review ')
  await input.evaluate(el => {
    const data = new DataTransfer(); data.setData('text/html', '<b>bold</b>'); data.setData('text/plain', '<b>plain</b>')
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true }))
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文' }))
  })
  await expect(input).toHaveText('Review <b>plain</b>')
  await expect(input.locator('b')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual([])
})

test('newlines around references survive remount with the caret on the restored last line', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('first ')
  await dropFile(input, 6, 'old.ts')
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await input.press('Control+End')
  await input.press('Control+j')
  await input.pressSequentially('second')
  await page.getByRole('button', { name: 'Remount', exact: true }).click()
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await input.press('Control+End')
  await input.press('Control+j')
  await input.pressSequentially('third')
  await input.press('Enter')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.sends)).toEqual(['first file: "C:/fixture/old.ts" \nsecond\nthird'])
})

test('inline references move between text segments and images remain native inputs', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  await page.evaluate(base64 => { window.electron.file.readBinary = async () => ({ base64, mimeType: 'image/png', size: 68 }) }, PNG_PIXEL)
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('First  last')
  await dropFile(input, 6, 'screen.png')
  await expect(input.locator('[data-reference-id]')).toHaveCount(1)
  await input.locator('[data-reference-id]').evaluate(chip => {
    const editor = chip.closest('[data-conversation-input]')!
    const range = document.createRange(); range.setStart(editor.lastChild!, editor.lastChild!.textContent!.length); range.collapse(true)
    const box = range.getBoundingClientRect(), dataTransfer = new DataTransfer()
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    editor.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer, clientX: box.x, clientY: box.y + 5 }))
    editor.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer, clientX: box.x, clientY: box.y + 5 }))
  })
  await expect(input).toHaveText('First   lastscreen.png×')
  await page.locator('[data-conversation-welcome]').evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).forEach(animation => animation.finish()))
  await page.screenshot({ path: 'artifacts/conversation-inline-reference/editor.png' })
  await input.press('Enter')
  const command = await page.evaluate(() => (window as any).codexFixture.calls.commands.find((command: any) => command.type === 'send'))
  expect(command.text).toBe('First   lastimage: "C:/fixture/screen.png"')
  expect(command.imagePaths).toEqual(['C:/fixture/screen.png'])
})
