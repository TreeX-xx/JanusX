import { expect, test, type Locator, type Page } from '@playwright/test'

// Note: exercise production controllers and renderers for each entry — see .agents/notes/agent/requirements/chat-work-timeline.md
const entries = [
  { name: 'Chat', query: '', selector: '[data-testid="main-chat"]' },
  { name: 'Project panel', query: '&workbench', selector: '.fixture-project-chat' },
  { name: 'Launch', query: '&launch-assistant', selector: '[data-testid="launch-chat"]' },
]
async function emit(page: Page, event: Record<string, unknown>) {
  await page.evaluate(event => {
    const fixture = (window as any).projectFixture
    fixture.emitAgentEvent({ requestId: fixture.streams.at(-1).requestId, ...event })
  }, event)
}
async function openEntry(page: Page, query: string) {
  await page.goto(`/project.html?manual-stream${query}`)
  await page.addStyleTag({ content: '.fixture-layout { display:flex; gap:12px; height:620px } .fixture-layout > section { width:420px; height:620px; min-height:0; } [data-testid="task"] {display:none} .fixture-layout .janus-chat {height:100%}' })
}
const order = (host: Locator) => host.locator('.janus-chat-timeline-block').evaluateAll(elements => elements.map(element => element.getAttribute('data-kind')))

for (const entry of entries) {
  test(`${entry.name}: input, user messages and process output support native selection and copy`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openEntry(page, entry.query)
    const host = page.locator(entry.selector)
    // The island and draggable panels can disable selection on an ancestor.
    await host.evaluate(element => { element.style.userSelect = 'none' })
    const input = host.locator('textarea')
    await input.fill('Copy this prompt')
    await expect(input).toHaveCSS('user-select', 'text')
    await input.click()
    const inputBounds = await input.evaluate(element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const canvas = document.createElement('canvas').getContext('2d')!
      canvas.font = style.font
      return {
        x: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        y: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2,
        width: canvas.measureText(element.value).width,
      }
    })
    await page.mouse.move(inputBounds.x + 1, inputBounds.y)
    await page.mouse.down()
    await page.mouse.move(inputBounds.x + inputBounds.width, inputBounds.y, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => input.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('Copy this prompt')
    await input.press('Control+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Copy this prompt')
    await input.press('End')
    await input.press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(1)
    await emit(page, { type: 'reasoning_delta', delta: 'Visible reasoning to copy' })
    await emit(page, { type: 'text_delta', delta: 'Visible answer to copy' })
    await emit(page, { type: 'stream_end', cancelled: false })

    for (const text of ['Copy this prompt', 'Visible reasoning to copy', 'Visible answer to copy']) {
      const target = host.getByText(text, { exact: true }).last()
      await target.scrollIntoViewIfNeeded()
      await target.click({ trial: true }) // Wait for message/host entrance animations to settle.
      await page.evaluate(() => window.getSelection()?.removeAllRanges())
      const bounds = await target.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const node = walker.nextNode()!
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = range.getBoundingClientRect()
        return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
      })
      await page.mouse.move(bounds.left + 1, bounds.y)
      await page.mouse.down()
      await page.mouse.move(bounds.right - 1, bounds.y, { steps: 12 })
      await page.mouse.up()
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
      await page.keyboard.press('Control+c')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text)
    }
  })

  test(`${entry.name}: ordered segments survive completion and reopening without replay`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await openEntry(page, entry.query)
    const host = page.locator(entry.selector)
    await host.locator('textarea').fill('Inspect the entry and explain the result')
    await host.locator('textarea').press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(1)
    await emit(page, { type: 'reasoning_delta', delta: 'First reasoning summary.\nChecking the entry.' })
    const thinking = host.locator('.janus-chat-thinking-toggle').first()
    await expect(thinking).toHaveAttribute('aria-expanded', 'true')
    await expect(host.locator('.janus-chat-thinking-body')).toContainText('Checking the entry.')
    await thinking.click()
    await expect(host.locator('.janus-chat-thinking-live')).toContainText('Checking the entry.')
    await thinking.click()
    await expect(host.locator('.janus-chat-thinking-body')).toContainText('First reasoning summary.')
    await emit(page, { type: 'text_delta', delta: 'I will read the entry.' })
    await emit(page, { type: 'tool_execution_start', callId: 'read-1', toolName: 'workspace.read' })
    await expect(host.locator('.janus-chat-thinking[data-streaming="true"]')).toHaveCount(0)
    const settledHeader = await thinking.innerText()
    await emit(page, { type: 'reasoning_delta', delta: 'Second reasoning summary.\nChecking the result.' })
    await emit(page, { type: 'text_delta', delta: 'I will verify the result.' })
    await emit(page, { type: 'tool_execution_start', callId: 'read-2', toolName: 'workspace.read' })
    await emit(page, { type: 'tool_execution_end', callId: 'read-2', toolName: 'workspace.read', status: 'completed' })
    await emit(page, { type: 'tool_execution_end', callId: 'read-1', toolName: 'workspace.read', status: 'completed' })
    await emit(page, { type: 'text_delta', delta: '**Final answer.**' })
    const expected = ['reasoning', 'text', 'tool', 'reasoning', 'text', 'tool', 'text']
    await expect.poll(() => order(host)).toEqual(expected)
    await expect(host.locator('.janus-chat-thinking-body')).toHaveCount(2)
    await expect(host.locator('[data-phase="process"]')).toHaveCount(2)
    await expect(host.locator('[data-phase="answer"]')).toContainText('Final answer.')
    await expect(thinking).toHaveText(settledHeader)
    await expect(host.locator('.janus-tool-card')).toHaveCount(2)
    for (const theme of ['planche', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await expect(thinking).toBeVisible()
      const colors = await host.evaluate(element => {
        const color = (selector: string) => getComputedStyle(element.querySelector(selector)!).color
        return {
          reasoning: color('.janus-chat-thinking-body pre'),
          process: color('[data-phase="process"] .markdown-preview'),
          answer: color('[data-phase="answer"]'),
        }
      })
      expect(colors.process).toBe(colors.reasoning)
      expect(colors.answer).not.toBe(colors.process)
    }
    await emit(page, { type: 'stream_end', cancelled: false })
    await expect.poll(() => order(host)).toEqual(expected)
    await expect(host.locator('.janus-chat-thinking[data-streaming="true"]')).toHaveCount(0)
    await expect(host.locator('.janus-chat-thinking-body')).toHaveCount(2)
    await expect(host.locator('.janus-tool-card--running')).toHaveCount(0)
    await expect(host.getByText('I will read the entry.', { exact: true })).toHaveCount(1)
    await expect(host.locator('strong').filter({ hasText: 'Final answer.' })).toHaveCount(1)
    await page.waitForTimeout(500) // Let the production persistence debounce settle.
    if (entry.name === 'Project panel') {
      await page.locator('.fixture-project-toggle').click()
      await page.locator('.fixture-project-toggle').click()
    } else await page.reload()
    await expect.poll(() => order(host)).toEqual(expected)
    await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(entry.name === 'Project panel' ? 1 : 0)
    await expect(host.locator('.janus-chat-thinking-toggle').first()).toHaveAttribute('aria-expanded', 'true')
    await expect(host.locator('.janus-chat-thinking-body').first()).toContainText('First reasoning summary.')
    expect(errors).toEqual([])
  })

  test(`${entry.name}: stopping retains process and ignores late events`, async ({ page }) => {
    await openEntry(page, entry.query)
    const host = page.locator(entry.selector)
    await host.locator('textarea').fill('Inspect the workspace')
    await host.locator('textarea').press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(1)
    await emit(page, { type: 'reasoning_delta', delta: 'An unfinished analysis.' })
    await emit(page, { type: 'tool_execution_start', callId: 'pending', toolName: 'workspace.read' })
    await host.locator(entry.name === 'Launch' ? 'button[data-mode="stop"]' : '.janus-chat-stop').click()
    await expect(host.locator('.janus-tool-card--cancelled')).toHaveCount(1)
    await emit(page, { type: 'text_delta', delta: 'Late output must be ignored' })
    await expect(host).not.toContainText('Late output must be ignored')
    await expect(host.locator('.janus-chat-thinking[data-streaming="true"]')).toHaveCount(0)
  })
}

test('Launch: early business result stays on its call and is not applied on reload', async ({ page }) => {
  await page.goto('/project.html?manual-stream&launch-assistant')
  const host = page.getByTestId('launch-chat')
  await host.locator('textarea').fill('Edit the draft')
  await host.locator('textarea').press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(1)
  await emit(page, { type: 'tool_execution_start', callId: 'edit', toolName: 'launch-config.edit' })
  await emit(page, { type: 'config_change', callId: 'edit', change: { id: 'config-1', summary: 'set program',
    config: { version: '0.1.0', projectType: 'custom', projectName: 'Fixture', configurations: [{ name: 'dev', type: 'custom', request: 'launch', program: 'debug.exe', env: { TOKEN: 'never-archive-this' } }] },
    validation: { valid: false, errors: [{ field: 'program', message: 'Missing entry' }], warnings: [] } } })
  await expect(host.locator('[data-config-state="draft"]')).toContainText('Missing entry')
  await emit(page, { type: 'tool_execution_end', callId: 'edit', toolName: 'launch-config.edit', status: 'completed' })
  await expect(host.locator('.janus-tool-card')).toHaveCount(1)
  await expect(host.locator('[data-config-state="applied"]')).toHaveCount(0)
  await emit(page, { type: 'stream_end', cancelled: false })
  await expect.poll(() => page.evaluate(() => (window as any).projectFixture.configChanges)).toBe(1)
  await page.reload()
  await expect(host.locator('[data-config-state="draft"]')).toContainText('Missing entry')
  expect(await page.evaluate(() => (window as any).projectFixture.configChanges ?? 0)).toBe(0)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('never-archive-this')
})

test('Project panel: Note business evidence stays inline, and undo checks current state', async ({ page }) => {
  await openEntry(page, '&workbench')
  const host = page.locator('.fixture-project-chat')
  await host.locator('textarea').fill('Update the selected Note')
  await host.locator('textarea').press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(1)
  await emit(page, { type: 'tool_execution_start', callId: 'note-edit', toolName: 'note.write' })
  await page.evaluate(() => {
    const fixture = (window as any).projectFixture
    const request = fixture.streams.at(-1)
    const graph = fixture.snapshot().graph
    const note = graph.nodes[graph.nodeIds[0]]
    fixture.emitAgentEvent({ type: 'note_focus', requestId: request.requestId, callId: 'note-edit', focus: {
      id: 'focus', conversationId: request.conversationId, workspacePath: 'C:/fixture', mode: 'access', focus: 'none', reason: 'Read target',
      notes: [{ uri: note.sourceUri, title: note.title, role: 'target', reason: 'Target' }],
    } })
    const change = { id: 'note-change', conversationId: request.conversationId, workspacePath: 'C:/fixture', txId: 'tx-1', reason: 'Updated the target Note',
      createdAt: new Date().toISOString(), files: [{ uri: note.sourceUri, title: note.title, before: 'Old body', after: 'New body' }] }
    fixture.noteChanges.push(change)
    fixture.emitAgentEvent({ type: 'note_change', requestId: request.requestId, callId: 'note-edit', change })
  })
  const call = host.locator('.janus-chat-timeline-block[data-call-id="note-edit"]')
  await expect(call).toContainText('Updated the target Note')
  await expect(call.locator('.bp-note-access')).toHaveCount(1)
  await emit(page, { type: 'tool_execution_end', callId: 'note-edit', toolName: 'note.write', status: 'completed' })
  await emit(page, { type: 'text_delta', delta: 'Finished editing.' })
  await emit(page, { type: 'stream_end', cancelled: false })
  await expect(host.getByText('Updated the target Note', { exact: true })).toHaveCount(1)
  await expect(call.locator('.janus-tool-card')).toHaveCount(1)
  await page.locator('.fixture-project-toggle').click()
  await page.locator('.fixture-project-toggle').click()
  expect(await page.evaluate(() => (window as any).projectFixture.undoApplies)).toBe(0)
  await page.evaluate(() => { (window as any).projectFixture.undoConflict = true })
  await call.getByRole('button', { name: /Undo|撤销/ }).click()
  await expect(call.getByRole('alert')).toBeVisible()
  expect(await page.evaluate(() => (window as any).projectFixture.undoApplies)).toBe(0)
  await page.evaluate(() => { (window as any).projectFixture.undoConflict = false })
  await call.getByRole('button', { name: /Undo|撤销/ }).click()
  await expect(call.getByRole('button', { name: /Undo|撤销/ })).toBeDisabled()
})

for (const entry of entries) {
  test(`${entry.name}: long process does not pull an upward reader to the bottom`, async ({ page }) => {
    await openEntry(page, entry.query)
    const host = page.locator(entry.selector)
    await host.locator('textarea').fill('Explain the whole workspace')
    await host.locator('textarea').press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).projectFixture.streams.length)).toBe(1)
    await emit(page, { type: 'text_delta', delta: Array.from({ length: 70 }, (_, index) => `Paragraph ${index}.\n\n`).join('') })
    await expect(host).toContainText('Paragraph 69.')
    const container = await host.locator('.janus-chat-timeline').evaluateHandle(element => {
      let current = element.parentElement
      while (current && !['auto', 'scroll'].includes(getComputedStyle(current).overflowY)) current = current.parentElement
      return current
    })
    expect(await container.evaluate(element => !!element && element.scrollHeight > element.clientHeight)).toBe(true)
    await container.evaluate(element => { element!.scrollTop = 0; element!.dispatchEvent(new Event('scroll')) })
    await emit(page, { type: 'reasoning_delta', delta: 'Later reasoning.\n' + 'r'.repeat(6000) })
    await emit(page, { type: 'tool_execution_start', callId: 'last', toolName: 'workspace.read' })
    await expect(host.locator('.janus-chat-thinking-toggle')).toContainText('Later reasoning.')
    expect(await container.evaluate(element => element!.scrollTop)).toBeLessThan(5)
    await expect(host.locator('.janus-chat-thinking-body')).toContainText(/截断|truncat|latest|最新|保留/i)
    await emit(page, { type: 'stream_end', cancelled: true })
  })
}
