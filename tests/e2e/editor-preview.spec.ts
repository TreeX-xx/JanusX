import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/editor-preview.html')
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('editing is the default; opt-in HEAD comparison preserves edits and cursor', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).previewHarness.baselineCalls)).toBe(0)
  await expect(page.locator('.monaco-diff-editor')).toHaveCount(0)
  await page.evaluate(() => (window as any).previewHarness.open('code.ts'))
  await expect(page.locator('.view-lines')).toContainText('value = 2')
  await page.locator('.monaco-editor').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('// unsaved')
  const position = await page.evaluate(() => (window as any).previewHarness.editors()[0].getPosition())
  const compare = page.getByRole('button', { name: '与 HEAD 比较' })
  await compare.click()
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  await compare.click()
  await expect(page.locator('.monaco-diff-editor')).toHaveCount(0)
  await expect(page.locator('.view-lines')).toContainText('// unsaved')
  expect(await page.evaluate(() => (window as any).previewHarness.editors()[0].getPosition())).toEqual(position)
  expect(await page.evaluate(() => (window as any).previewHarness.state().openFiles.find((file: any) => file.name === 'code.ts').isDirty)).toBe(true)
  await page.evaluate(() => (window as any).previewHarness.open('missing.ts', 'const newFile = true'))
  await compare.click()
  await expect(page.getByRole('status')).toContainText('没有可用的 HEAD 基线')
  await expect(page.locator('.monaco-diff-editor')).toHaveCount(0)
})

test('narrow diff has one gutter, numbered deletions and persistent layout controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 560, height: 720 })
  await page.evaluate(async () => {
    const h = (window as any).previewHarness
    h.baselines['code.ts'] = [
      'const keep = 0',
      `const removed = '${'long deleted text '.repeat(12)}'`,
      'const removedToo = 1',
      'const value = 1',
      'const last = 0',
    ].join('\n')
    await h.open('code.ts', 'const keep = 0\nconst value = 2\nconst last = 0')
  })
  await page.getByRole('button', { name: '与 HEAD 比较' }).click()
  const diff = page.locator('.monaco-diff-editor')
  const inline = page.getByRole('button', { name: '合并', exact: true })
  const split = page.getByRole('button', { name: '并排', exact: true })
  await expect(inline).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => diff.locator('.editor.original').evaluate(el => el.getBoundingClientRect().width)).toBe(0)
  await expect(diff.locator('.diff-deleted-line-number')).toHaveText(['2', '3', '4'])
  // Wrapped old lines must advance following old numbers by their rendered height.
  await expect.poll(() => diff.locator('.diff-deleted-line-number').evaluateAll(nodes =>
    parseFloat((nodes[1] as HTMLElement).style.top) - parseFloat((nodes[0] as HTMLElement).style.top),
  )).toBeGreaterThan(24)
  await expect(diff.locator('.editor.modified .view-lines[data-mprt]')).toContainText('const value = 2')
  await expect(page.getByRole('button', { name: '下一处变更' })).toBeEnabled()
  await page.getByRole('button', { name: '下一处变更' }).click()
  await page.screenshot({ path: testInfo.outputPath('diff-unified-dark.png') })
  await split.click()
  await expect(split).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).previewHarness.diffEditors()[0].getOriginalEditor().getLayoutInfo().width)).toBeGreaterThan(100)
  await page.setViewportSize({ width: 1100, height: 720 })
  await expect(split).toHaveAttribute('aria-pressed', 'true')
  await inline.click()
  await page.setViewportSize({ width: 560, height: 720 })
  await page.setViewportSize({ width: 1100, height: 720 })
  await expect(inline).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => (window as any).previewHarness.setTheme('planche'))
  await expect(diff.locator('.diff-deleted-line-number')).toHaveText(['2', '3', '4'])
  await page.screenshot({ path: testInfo.outputPath('diff-unified-planche.png') })
  await page.getByRole('button', { name: '与 HEAD 比较' }).click()
  await expect(page.locator('.diff-deleted-line-number')).toHaveCount(0)
  await page.getByRole('button', { name: '与 HEAD 比较' }).click()
  await expect(inline).toHaveAttribute('aria-pressed', 'true')
})

test('automatic diff layout follows width and handles separated deletions, additions and empty files', async ({ page }) => {
  await page.evaluate(async () => {
    const h = (window as any).previewHarness
    const context = Array.from({ length: 55 }, (_, i) => `const keep${i} = ${i}`)
    h.baselines['code.ts'] = ['const oldFirst = 1', ...context, 'const oldLast = 1'].join('\n')
    await h.open('code.ts', context.join('\n'))
  })
  await page.getByRole('button', { name: '与 HEAD 比较' }).click()
  await expect(page.getByRole('button', { name: '并排', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('原版本 · HEAD', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 560, height: 720 })
  await expect(page.getByRole('button', { name: '合并', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.locator('.diff-deleted-line-number').evaluateAll(nodes =>
    nodes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(node => node.textContent),
  )).toEqual(['1', '57'])
  await page.getByRole('button', { name: '下一处变更' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).previewHarness.diffEditors()[0].getModifiedEditor().getPosition().lineNumber)).toBeGreaterThan(50)
  await page.getByRole('button', { name: '上一处变更' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).previewHarness.diffEditors()[0].getModifiedEditor().getPosition().lineNumber)).toBeLessThan(5)
  // Replace with a pure insertion, then an empty and finally identical file.
  await page.evaluate(() => {
    const h = (window as any).previewHarness
    h.state().updateContent(h.state().activeFileId, h.baselines['code.ts'] + '\nconst added = 1')
  })
  await expect(page.locator('.diff-deleted-line-number')).toHaveCount(0)
  await page.evaluate(() => {
    const h = (window as any).previewHarness
    h.state().updateContent(h.state().activeFileId, '')
  })
  await expect(page.locator('.diff-deleted-line-number')).toHaveCount(57)
  await page.evaluate(() => {
    const h = (window as any).previewHarness
    h.state().updateContent(h.state().activeFileId, h.baselines['code.ts'])
  })
  await expect(page.getByRole('button', { name: '下一处变更' })).toBeDisabled()
  await expect(page.locator('.diff-deleted-line-number')).toHaveCount(0)
})

test('custom dialog supports cancel, failed-save retry, multiple files and discard', async ({ page }, testInfo) => {
  await page.evaluate(async () => {
    const h = (window as any).previewHarness
    const id = h.state().activeFileId
    h.state().updateContent(id, '# Changed')
    await h.open('code.ts')
    h.state().updateContent(h.state().activeFileId, '// Changed')
    h.failSave = true
  })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '是否保存更改？' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('li')).toHaveCount(2)
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '保存并关闭' })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('save-dialog-dark.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => (window as any).previewHarness.closed)).toBe(0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.getByRole('button', { name: '保存并关闭' }).click()
  await expect(dialog.getByRole('alert')).toContainText('无法保存')
  await page.evaluate(() => (window as any).previewHarness.setTheme('planche'))
  await page.screenshot({ path: testInfo.outputPath('save-dialog-light-error.png') })
  expect(await page.evaluate(() => (window as any).previewHarness.closed)).toBe(0)
  await page.evaluate(() => { (window as any).previewHarness.failSave = false })
  await dialog.getByRole('button', { name: '保存并关闭' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => (window as any).previewHarness.saves.length)).toBe(2)
  await page.evaluate(() => {
    const h = (window as any).previewHarness
    h.state().updateContent(h.state().activeFileId, '// discard')
  })
  await page.getByRole('button', { name: '关闭 code.ts' }).click()
  await dialog.getByRole('button', { name: '不保存', exact: true }).click()
  await expect(page.locator('[data-editor-tab]')).toHaveCount(1)
})

test('Markdown follows source blocks, resizes, reaches the end and can disable sync', async ({ page }) => {
  const viewport = page.locator('.preview-scroll-viewport')
  await page.evaluate(() => {
    const editor = (window as any).previewHarness.editors().find((item: any) => item.getDomNode()?.closest('#root'))
    const block = document.querySelectorAll<HTMLElement>('[data-source-line]')[30]
    editor.setScrollTop(editor.getTopForLineNumber(Number(block.dataset.sourceLine)))
  })
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(500)
  await expect.poll(() => page.locator('[data-source-line]').nth(30).evaluate(el => {
    const viewport = el.closest('.preview-scroll-viewport')!
    return Math.abs(el.getBoundingClientRect().top - viewport.getBoundingClientRect().top)
  })).toBeLessThan(4)
  await page.setViewportSize({ width: 960, height: 640 })
  await page.evaluate(() => {
    const editor = (window as any).previewHarness.editors()[0]
    editor.setScrollTop(editor.getScrollHeight())
  })
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3)
  await page.getByRole('button', { name: '同步滚动' }).click()
  await expect(page.getByRole('button', { name: '同步滚动' })).toHaveAttribute('aria-pressed', 'false')
  const before = await viewport.evaluate(el => el.scrollTop)
  await page.evaluate(() => (window as any).previewHarness.editors()[0].setScrollTop(0))
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Section 0')
  expect(await viewport.evaluate(el => el.scrollTop)).toBeCloseTo(before, 0)
})

for (const theme of ['planche', 'dark']) {
  test(`${theme} icon modes support keyboard selection, narrow menus and file preferences`, async ({ page }, testInfo) => {
    await page.evaluate(theme => (window as any).previewHarness.setTheme(theme), theme)
    const modes = page.getByRole('radiogroup', { name: '文件显示模式' })
    await expect(modes.getByRole('radio')).toHaveCount(3)
    const split = modes.getByRole('radio', { name: '双栏', exact: true })
    await expect(split).toBeChecked()
    await split.focus()
    await split.press('ArrowLeft')
    await expect(modes.getByRole('radio', { name: '代码', exact: true })).toBeChecked()
    await expect(page.locator('.preview-scroll-viewport')).toHaveCount(0)
    await page.keyboard.press('End')
    await expect(modes.getByRole('radio', { name: '预览', exact: true })).toBeChecked()
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    await page.keyboard.press('ArrowUp')
    await expect(split).toBeChecked()
    await page.setViewportSize({ width: 360, height: 640 })
    await expect(split).toBeChecked()
    const find = page.getByRole('button', { name: '查找', exact: true })
    await expect(find).toBeHidden()
    await page.getByRole('button', { name: '更多文件操作' }).click()
    await expect(page.getByRole('dialog', { name: '更多文件操作' }).getByRole('button', { name: '查找', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '更多文件操作' })).toBeFocused()
    expect(await page.locator('.editor-titlebar').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThan(2)
    await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`) })
    await page.evaluate(() => (window as any).previewHarness.open('code.ts'))
    await expect(modes).toHaveCount(0)
    await page.locator('[data-editor-tab]').filter({ hasText: 'notes.md' }).click()
    await expect(split).toBeChecked()
  })
}
