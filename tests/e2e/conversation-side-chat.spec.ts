import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ChatStreamRequest } from '../../src/shared/ipc/llm'

async function setup(page: Page, query = '') {
  await page.goto('/codex-conversation.html?initialView=conversation' + query)
  await expect(page.getByRole('button', { name: 'Side chat', exact: true }).first()).toBeVisible()
  await page.evaluate(() => {
    const requests: ChatStreamRequest[] = [], aborted: string[] = []
    const events = new EventTarget()
    const listen = (name: string) => (callback: (payload: unknown) => void) => {
      const listener = (e: Event) => callback((e as CustomEvent).detail)
      events.addEventListener(name, listener)
      return () => events.removeEventListener(name, listener)
    }
    Object.assign(window.electron.llm, {
      getTerminalDefault: async () => ({ provider: { id: 'fixture' }, modelId: 'side-model' }),
      onDelta: listen('delta'), onDone: listen('done'), onError: listen('error'),
      startChatStream: (request: ChatStreamRequest) => requests.push(request),
      abortChat: async (id: string) => { aborted.push(id) },
    })
    Object.assign(window, { sideFixture: { requests, aborted, emit: (name: string, payload: object, index = requests.length - 1) =>
      events.dispatchEvent(new CustomEvent(name, { detail: { requestId: requests[index].requestId, ...payload } })) } })
    ;(window as any).codexFixture.progressSnapshot({ turnId: 'working', items: [
      { id: 'q', turnId: 'working', type: 'userMessage', status: 'completed', text: 'Review the index.' },
      { id: 'a', turnId: 'working', type: 'agentMessage', status: 'inProgress', text: 'Rebuild the index before switching branches.' },
    ] })
  })
}

async function selectText(element: Locator, text: string) {
  await element.evaluate((el, value) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const at = node.textContent!.indexOf(value)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at); range.setEnd(node, at + value.length)
      const selection = getSelection()!
      selection.removeAllRanges(); selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error('Missing text: ' + value)
  }, text)
}

for (const engine of ['codex', 'claude', 'opencode', 'pi', 'dsh']) {
  test(`${engine} opens a side chat with a frozen recent exchange`, async ({ page }) => {
    await setup(page, '&engine=' + engine)
    await page.getByRole('button', { name: 'Side chat', exact: true }).click()
    const side = page.getByRole('complementary', { name: 'Side chat' })
    await expect(side.getByRole('textbox')).toBeFocused()
    await side.getByText('Latest exchange').click()
    await expect(side.locator('pre')).toContainText('Review the index.')
    await page.evaluate(() => (window as any).codexFixture.delta(' New delta.'))
    await expect(side.locator('pre')).not.toContainText('New delta')
    await expect(side).toContainText('side-model')
    const pane = await page.locator('[data-agent-session]').boundingBox()
    expect((await side.boundingBox())!.width).toBeLessThan(pane!.width / 2)
  })
}

test('isolates an in-flight quote, follow-up and draft return across workspace panes', async ({ page }) => {
  await setup(page, '&split=side&crossWorkspace')
  const a = page.locator('[data-fixture-pane=first]'), b = page.locator('[data-fixture-pane=second]')
  const inputA = a.getByRole('combobox'), inputB = b.getByRole('combobox')
  await inputA.fill('Existing A draft')
  await selectText(a.locator('[data-side-item=a] p'), 'the index')
  await a.getByRole('button', { name: 'Ask in side chat' }).click()
  const side = a.getByRole('complementary', { name: 'Side chat' })
  expect(Math.round((await side.boundingBox())!.width)).toBe(Math.round((await a.boundingBox())!.width))
  await side.getByRole('textbox').fill('Why rebuild?')
  await side.getByRole('textbox').press('Enter')
  await inputB.fill('Keep B draft')
  await page.evaluate(() => {
    const { requests, emit } = (window as any).sideFixture
    if (!requests[0].sideChat || requests[0].messages.at(-1).content.includes('before switching branches')) throw new Error('Incorrect side context')
    ;(window as any).codexFixture.delta(' Continuing work.')
    emit('delta', { delta: 'Index entries are stale.' }); emit('done', {})
  })
  await expect(inputB).toBeFocused()
  await expect(side.getByText('Index entries are stale.')).toBeVisible()
  await side.getByRole('textbox').fill('What about new entries?')
  await side.getByRole('textbox').press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).sideFixture.requests[1]?.messages)).toEqual(expect.arrayContaining([
    { role: 'assistant', content: 'Index entries are stale.' }, { role: 'user', content: 'What about new entries?' },
  ]))
  await side.getByRole('button', { name: 'Stop side response' }).click()
  await selectText(side.locator('[data-side-answer] p'), 'entries are stale')
  await side.getByRole('button', { name: 'Add to main draft' }).click()
  await expect(inputA).toContainText('Existing A draft')
  await expect(inputA).toContainText('entries are stale')
  await expect(inputA).not.toContainText('Index entries')
  await expect(inputB).toHaveText('Keep B draft')
  expect(await page.evaluate(() => (window as any).codexFixture.calls.commands)).toEqual([])
  await a.getByRole('button', { name: 'Side chat', exact: true }).click()
  await expect(side.getByText('Response stopped')).toBeVisible()
})

test('quotes unsent text, restores selection and isolates replacement threads', async ({ page }) => {
  await setup(page)
  const input = page.getByRole('combobox')
  await input.fill('My unpublished idea')
  await selectText(input, 'unpublished')
  await page.getByRole('button', { name: 'Ask in side chat' }).click()
  const side = page.getByRole('complementary', { name: 'Side chat' })
  await expect(side).toContainText('Main draft')
  await side.getByRole('textbox').press('Escape')
  await expect(input).toBeFocused()
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('unpublished')
  await expect(input).toHaveText('My unpublished idea')
  await page.getByRole('button', { name: 'Side chat', exact: true }).click()
  await side.getByRole('textbox').fill('Explain')
  await side.getByRole('textbox').press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).sideFixture.requests.length)).toBe(1)
  await page.evaluate(() => { (window as any).codexFixture.changeThread(); (window as any).sideFixture.emit('delta', { delta: 'Late old answer' }) })
  await expect(side).toBeHidden()
  expect(await page.evaluate(() => (window as any).sideFixture.aborted.length)).toBe(1)
  await page.getByRole('button', { name: 'Side chat', exact: true }).click()
  await expect(side).not.toContainText('unpublished')
  await expect(side).not.toContainText('Late old answer')
})

test('keeps an unanswered draft through configuration and retries a failed request', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => Object.assign(window.electron.llm, { getTerminalDefault: async () => null }))
  await page.getByRole('button', { name: 'Side chat', exact: true }).click()
  const side = page.getByRole('complementary', { name: 'Side chat' })
  await side.getByRole('textbox').fill('Keep my question')
  await expect(side.getByRole('button', { name: 'Send side question' })).toBeDisabled()
  await expect(side.getByRole('button', { name: 'Model settings' })).toBeVisible()
  await page.evaluate(() => {
    Object.assign(window.electron.llm, { getTerminalDefault: async () => ({ provider: { id: 'p' }, modelId: 'restored' }) })
    window.dispatchEvent(new Event('janus:llm-config-changed'))
  })
  await side.getByRole('button', { name: 'Send side question' }).click()
  await page.evaluate(() => (window as any).sideFixture.emit('error', { error: 'offline' }))
  await expect(side.getByRole('alert')).toContainText('offline')
  await side.getByRole('button', { name: 'Retry' }).click()
  await page.evaluate(() => (window as any).sideFixture.emit('done', {}))
  await expect(side.getByRole('alert')).toContainText('The model returned no text')
  await expect(side.getByText('Keep my question', { exact: true })).toHaveCount(1)
})

test('quotes code and a file patch, keeping the original file path and text after remount', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => (window as any).codexFixture.progressSnapshot({ turnId: null, items: [
    { id: 'code', turnId: 'review', type: 'agentMessage', status: 'completed', text: 'Example:\n\n```js\nconst count = 2\n```' },
    { id: 'diff', turnId: 'review', type: 'fileChange', status: 'completed', text: '', files: [{ path: 'src/count.ts', diff: '@@ -1 +1 @@\n-const count = 1\n+const count = 2' }] },
  ] }))
  await selectText(page.locator('[data-side-item=code] code'), 'count = 2')
  await page.getByRole('button', { name: 'Ask in side chat' }).click()
  const side = page.getByRole('complementary', { name: 'Side chat' })
  await expect(side).toContainText('Quoted reply')
  await side.getByRole('button', { name: 'Close side chat' }).click()
  await page.locator('[data-turn-files=review] > summary').click()
  await page.locator('[data-turn-files=review] details > summary').click()
  await selectText(page.locator('pre[data-side-path]'), '+const count = 2')
  await page.getByRole('button', { name: 'Ask in side chat' }).click()
  await side.getByRole('textbox').fill('Why did this change?')
  await page.getByRole('button', { name: 'Remount' }).click()
  await expect(side.getByRole('textbox')).toHaveValue('Why did this change?')
  await side.getByRole('button', { name: 'Send side question' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).sideFixture.requests[0]?.messages.at(-1).content)).toBe('Quoted diff (src/count.ts):\n+const count = 2\n\nQuestion:\nWhy did this change?')
})

test('stopping one of two simultaneous side requests leaves the other running', async ({ page }) => {
  await setup(page, '&split=side&crossWorkspace')
  const panes = page.locator('[data-fixture-pane]')
  for (const [index, question] of ['Question A', 'Question B'].entries()) {
    const pane = panes.nth(index)
    await pane.getByRole('button', { name: 'Side chat', exact: true }).click()
    await pane.getByRole('textbox').fill(question)
    await pane.getByRole('button', { name: 'Send side question' }).click()
  }
  await panes.first().getByRole('button', { name: 'Stop side response' }).click()
  await page.evaluate(() => {
    const fixture = (window as any).sideFixture
    fixture.emit('delta', { delta: 'Stale A' }, 0)
    fixture.emit('delta', { delta: 'Answer B' }, 1)
    fixture.emit('done', {}, 1)
  })
  await expect(panes.first()).not.toContainText('Stale A')
  await expect(panes.first()).not.toContainText('Answer B')
  await expect(panes.last().getByText('Answer B')).toBeVisible()
  expect(await page.evaluate(() => {
    const f = (window as any).sideFixture
    return f.requests.map((r: ChatStreamRequest) => f.aborted.includes(r.requestId))
  })).toEqual([true, false])
})
