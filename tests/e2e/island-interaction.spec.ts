import { expect, test, type Locator, type Page } from '@playwright/test'

async function pointer(locator: Locator, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', options: { x?: number; y?: number; button?: number; pointerId?: number; isPrimary?: boolean } = {}) {
  await locator.dispatchEvent(type, {
    bubbles: true,
    pointerType: 'mouse',
    pointerId: options.pointerId ?? 1,
    isPrimary: options.isPrimary ?? true,
    button: options.button ?? 0,
    clientX: options.x ?? 100,
    clientY: options.y ?? 20,
  })
}

async function tap(island: Locator, point = { x: 100, y: 20 }) {
  await pointer(island, 'pointerdown', point)
  await pointer(island, 'pointerup', point)
}

function harness(page: Page) {
  return page.getByTestId('harness')
}

function islandExpandedChatButton(page: Page) {
  return page.locator('.janus-island .janus-expanded-view-button[data-view="chat"]')
}

function islandExpandedRoundtableButton(page: Page) {
  return page.locator('.janus-island .janus-expanded-view-button[data-view="roundtable"]')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.janus-island')).toBeVisible()
})

test('approval panel is distinct, compact, and exposes explicit decisions', async ({ page }) => {
  await page.goto('/?approval=1')
  await page.getByTestId('reopen-island').click()
  await islandExpandedChatButton(page).click()

  const approval = page.getByRole('region', { name: 'Workspace edit approval' })
  const reject = approval.getByRole('button', { name: 'Reject workspace action' })
  const approve = approval.getByRole('button', { name: 'Approve workspace action' })
  await expect(approval).toBeVisible()
  await expect(approval.getByText('Approval required')).toBeVisible()
  await expect(approval.getByText('workspace.edit / write')).toBeVisible()
  await expect(reject).toBeVisible()
  await expect(approve).toBeVisible()

  const approvalBox = await approval.boundingBox()
  const rejectBox = await reject.boundingBox()
  const approveBox = await approve.boundingBox()
  expect(approvalBox).not.toBeNull()
  expect(rejectBox).not.toBeNull()
  expect(approveBox).not.toBeNull()
  expect(rejectBox!.x + rejectBox!.width).toBeLessThanOrEqual(approveBox!.x)
  expect(approveBox!.x + approveBox!.width).toBeLessThanOrEqual(approvalBox!.x + approvalBox!.width)
  await page.screenshot({ path: test.info().outputPath('approval-panel-desktop.png') })

  await page.setViewportSize({ width: 720, height: 720 })
  await expect(approval).toBeVisible()
  await expect(reject).toBeVisible()
  await expect(approve).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('approval-panel-compact.png') })

  await reject.click()
  await expect(approval).toHaveCount(0)
  await expect(harness(page)).toHaveAttribute('data-approval-decision', 'rejected')
})

test('single activation opens the notification center sheet on the capsule', async ({ page }) => {
  const island = page.locator('.janus-island')
  const shell = page.locator('.janus-island-shell')
  await tap(island)

  // 单击不进 peek：折叠胶囊自身纵向长出通知面（空态可见）。
  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(shell).toHaveAttribute('data-notif', 'true', { timeout: 1_000 })
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
  await expect(page.getByText('No notice history')).toBeVisible()

  // 点空白处 = 看过即焚收起（lab「点舞台空白」语义）。
  await page.mouse.click(30, 500)
  await expect(shell).toHaveAttribute('data-notif', 'false', { timeout: 2_000 })

  // 再开再单击 = 看过即焚收起（stagger 溶解后清史）。
  await tap(island)
  await expect(shell).toHaveAttribute('data-notif', 'true', { timeout: 1_000 })
  await tap(island)
  await expect(shell).toHaveAttribute('data-notif', 'false', { timeout: 2_000 })
})

test('second pointerdown activates expanded exactly once and cancels single activation', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island, { x: 100, y: 20 })
  await page.waitForTimeout(80)
  await pointer(island, 'pointerdown', { x: 108, y: 24, pointerId: 2 })

  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  await pointer(island, 'pointerup', { x: 108, y: 24, pointerId: 2 })
  await page.waitForTimeout(500)
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
  await expect(harness(page)).toHaveAttribute('data-double-count', '1')
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
})

test('double activation collapses expanded Island exactly once', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')

  await tap(island, { x: 110, y: 25 })
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 114, y: 27, pointerId: 3 })
  await pointer(island, 'pointerup', { x: 114, y: 27, pointerId: 3 })

  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await page.waitForTimeout(500)
  await expect(harness(page)).toHaveAttribute('data-double-count', '2')
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
})

test('expanded Chat remains clickable while Island background double activation still collapses', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island, { x: 100, y: 20 })
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')

  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Element | null
      if (!target?.closest('.janus-expanded-view-button')) return
      const islandElement = target.closest('.janus-island')
      ;(window as typeof window & { chatPointerState?: unknown }).chatPointerState = {
        defaultPrevented: event.defaultPrevented,
        pointerCaptured: islandElement?.hasPointerCapture(event.pointerId) ?? false,
      }
    }, { once: true })
  })

  await islandExpandedChatButton(page).click()
  await expect(page.locator('.janus-island-shell')).toHaveAttribute('data-view', 'chat')
  await expect(page.locator('.janus-chat')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { chatPointerState?: unknown }
  ).chatPointerState)).toEqual({ defaultPrevented: false, pointerCaptured: false })

  await tap(island, { x: 110, y: 25 })
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 114, y: 27, pointerId: 3 })
  await pointer(island, 'pointerup', { x: 114, y: 27, pointerId: 3 })

  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(harness(page)).toHaveAttribute('data-double-count', '2')
})

test('Roundtable keeps parchment above a discussion-only Chat', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedRoundtableButton(page).click()

  const discussion = island.locator('.janus-roundtable-center .janus-chat--discussion-only')
  await island.locator('.janus-roundtable-scroll').click({ force: true })
  const auxiliary = page.locator('.janus-auxiliary-island[data-module="roundtable-parchment"]')
  await expect(auxiliary).toBeVisible()
  await expect(auxiliary.locator('.janus-roundtable-parchment[data-detailed="true"]')).toBeVisible()
  const stage = island.locator('.janus-roundtable-stage')
  await expect(stage).toBeVisible()
  await expect(stage.locator('.janus-roundtable-seat')).toHaveCount(4)
  await expect(stage.getByRole('button', { name: '动态' })).toBeVisible()
  await stage.getByRole('button', { name: /JanusX，主持人/ }).click({ force: true })
  await expect(discussion).toBeVisible()
  await expect(discussion.getByRole('button', { name: 'Attach workspace' })).toHaveCount(0)
  await expect(discussion.locator('textarea')).toBeVisible()
  await expect(discussion.locator('.janus-chat-sidebar, .janus-chat-toolbar, .janus-chat-status-bar')).toHaveCount(0)

  for (const viewport of [{ width: 1280, height: 720 }, { width: 720, height: 720 }]) {
    await page.setViewportSize(viewport)
    const parchmentBox = await auxiliary.boundingBox()
    const discussionBox = await discussion.boundingBox()
    expect(parchmentBox).not.toBeNull()
    expect(discussionBox).not.toBeNull()
    expect(parchmentBox!.height).toBeGreaterThan(0)
    expect(discussionBox!.height).toBeGreaterThan(0)
    await page.screenshot({ path: test.info().outputPath(`roundtable-${viewport.width}.png`) })
  }
})

test('Roundtable parchment opens a modular auxiliary Island and returns to stacked layout', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedRoundtableButton(page).click()

  const scroll = island.locator('.janus-roundtable-scroll')
  await scroll.click({ force: true })
  const shell = page.locator('.janus-island-shell')
  const auxiliary = page.locator('.janus-auxiliary-island[data-module="roundtable-parchment"]')
  await expect(shell).toHaveAttribute('data-auxiliary-open', 'true')
  await expect(auxiliary).toBeVisible()
  await expect(auxiliary.locator('.janus-roundtable-parchment[data-detailed="true"]')).toBeVisible()

  const mainBox = await island.boundingBox()
  const auxiliaryBox = await auxiliary.boundingBox()
  expect(mainBox).not.toBeNull()
  expect(auxiliaryBox).not.toBeNull()
  expect(Math.abs(mainBox!.height - auxiliaryBox!.height)).toBeLessThanOrEqual(4)

  await page.setViewportSize({ width: 1600, height: 720 })
  await expect(auxiliary).toBeVisible()
  const wideAuxiliaryBox = await auxiliary.boundingBox()
  expect(wideAuxiliaryBox).not.toBeNull()
  expect(wideAuxiliaryBox!.x).toBeGreaterThan(0)
  expect(wideAuxiliaryBox!.x + wideAuxiliaryBox!.width).toBeLessThanOrEqual(1640)

  await page.keyboard.press('Escape')
  await expect(auxiliary).toHaveCount(0)
  await expect(shell).toHaveAttribute('data-stage', 'expanded')

  await scroll.click({ force: true })
  await expect(auxiliary).toBeVisible()
  await auxiliary.getByRole('button', { name: /Collapse parchment/i }).click()
  await expect(auxiliary).toHaveCount(0)
  await expect(shell).toHaveAttribute('data-auxiliary-open', 'false')
})

test('Island Chat action docks the shared presentation', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island, { x: 100, y: 20 })
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  await islandExpandedChatButton(page).click()

  const islandChat = page.locator('.janus-island .janus-chat')
  await expect(islandChat.getByText('Shared controller message')).toBeVisible()
  await expect(islandChat.getByText('Shared pending stream')).toBeVisible()
  await expect(islandChat.getByRole('button', { name: 'Attach workspace' })).toHaveCount(0)
  await expect(islandChat.getByRole('button', { name: /Embed Chat in / })).toHaveCount(0)
  await expect(page.locator('.janus-chat')).toHaveCount(1)

  await page.getByTestId('toggle-streaming').click()
  await islandChat.locator('textarea').click()
  await expect(islandChat.locator('textarea')).toBeFocused()

  await page.keyboard.press('Control+P')
  await expect(islandChat.locator('[role="listbox"][data-selection-menu="model"]')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(harness(page)).toHaveAttribute('data-active-model', 'model-a2')

  await page.keyboard.press('Tab')
  await expect(islandChat.locator('[role="listbox"][data-selection-menu="provider"]')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(harness(page)).toHaveAttribute('data-active-provider', 'provider-b')
})

test('Chat input recalls sent prompts and restores the current draft', async ({ page }) => {
  await page.getByTestId('toggle-streaming').click()
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedChatButton(page).click()

  const input = page.locator('.janus-island .janus-chat').locator('textarea')
  await input.fill('Unsent draft')
  await page.keyboard.press('ArrowUp')
  await expect(input).toHaveValue('Latest recalled prompt')
  await page.keyboard.press('ArrowUp')
  await expect(input).toHaveValue('First recalled prompt')
  await page.keyboard.press('ArrowDown')
  await expect(input).toHaveValue('Latest recalled prompt')
  await page.keyboard.press('ArrowDown')
  await expect(input).toHaveValue('Unsent draft')
})

test('Chat rewrites a previous turn in place, removes its reply, and clears the visible conversation', async ({ page }) => {
  await page.getByTestId('toggle-streaming').click()
  await page.getByTestId('reopen-island').click()
  await islandExpandedChatButton(page).click()

  const chat = page.locator('.janus-island .janus-chat')
  const composer = chat.locator('.janus-chat-input')
  await chat.getByRole('button', { name: 'Edit and resubmit' }).last().click()
  const editor = chat.getByRole('textbox', { name: 'Edit history question' })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Latest recalled prompt')
  await expect(composer).toHaveValue('')

  await editor.fill('Latest recalled prompt, with more detail')
  await editor.press('Enter')
  await expect(harness(page)).toHaveAttribute('data-last-rewrite-id', 'prompt-two')
  await expect(harness(page)).toHaveAttribute('data-last-rewrite-content', 'Latest recalled prompt, with more detail')
  await expect(harness(page)).toHaveAttribute('data-last-sent-prompt', '')
  await expect(editor).toHaveCount(0)
  await expect(chat.getByText('Latest recalled prompt, with more detail')).toBeVisible()
  await expect(chat.getByText('Latest controller response')).toHaveCount(0)
  await expect(chat.getByText('Shared controller message')).toBeVisible()

  const clear = chat.getByRole('button', { name: 'Clear current conversation' })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(harness(page)).toHaveAttribute('data-clear-count', '1')
  await expect(composer).toHaveValue('')
})

test('model menu stays visible and keyboard-operable while Chat is streaming', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedChatButton(page).click()

  const chat = page.locator('.janus-island .janus-chat')
  await expect(chat).toBeFocused()
  await chat.locator('.janus-chat-model-tag').click()
  const menu = chat.locator('[role="listbox"][data-selection-menu="model"]')
  await expect(menu).toBeVisible()
  await expect(chat.locator('.janus-chat-input-wrapper')).toHaveCSS('overflow', 'visible')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(harness(page)).toHaveAttribute('data-active-model', 'model-a2')
  await expect(menu).toHaveCount(0)
})

test('Island Chat switches conversations while the current thread is streaming', async ({ page }) => {
  await page.goto('/?providerStream=1')
  await page.getByTestId('fail-provider-thread').click()
  await expect(harness(page)).toHaveAttribute('data-provider-error', 'Fixture stream error')
  await page.getByTestId('start-provider-stream').click()
  await expect(harness(page)).toHaveAttribute('data-provider-streaming', 'true')
  await expect(harness(page)).toHaveAttribute('data-provider-stream-count', '2')
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedChatButton(page).click()

  const chat = page.locator('.janus-island .janus-chat')
  const threadTrigger = chat.getByRole('button', { name: 'Select conversation' })
  await expect(threadTrigger).toBeEnabled()
  await threadTrigger.click()
  const threadMenu = chat.getByRole('menu', { name: 'Conversations' })
  await expect(threadMenu).toBeVisible()
  await expect(threadMenu.getByText('Streaming thread', { exact: true })).toBeVisible()
  await expect(threadMenu.getByText('Other thread', { exact: true })).toBeVisible()
  await expect(threadMenu.getByLabel('Generating')).toBeVisible()
  await expect(threadMenu.getByLabel('Conversation error')).toBeVisible()
  // Click the messages area centre: (8,8) sits under the open dropdown.
  await chat.locator('.janus-chat-messages').click()
  await expect(threadMenu).toHaveCount(0)
  await threadTrigger.click()
  await threadMenu.locator('.janus-chat-thread-row', { hasText: 'Other thread' }).locator('.janus-chat-thread-main').click()

  await expect(threadTrigger).toContainText('Other thread')
  await threadTrigger.click()
  await expect(chat.getByRole('menu', { name: 'Conversations' }).getByLabel('Generating')).toBeVisible()
  await expect(harness(page)).toHaveAttribute('data-provider-streaming', 'true')
  await expect(harness(page)).toHaveAttribute('data-provider-abort-count', '0')
})

test('Tab and Ctrl+P menus respond to every arrow key', async ({ page }) => {
  await page.getByTestId('toggle-streaming').click()
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedChatButton(page).click()

  const chat = page.locator('.janus-island .janus-chat')
  const input = chat.locator('textarea')
  await expect(input).toBeFocused()
  await page.keyboard.press('Control+P')
  const modelMenu = chat.locator('[role="listbox"][data-selection-menu="model"]')
  await expect(modelMenu).toBeVisible()
  const selectedModel = modelMenu.locator('[role="option"][aria-selected="true"]')
  await expect(selectedModel).toContainText('model-a1')
  await page.keyboard.press('ArrowRight')
  await expect(selectedModel).toContainText('model-a2')
  await page.keyboard.press('ArrowLeft')
  await expect(selectedModel).toContainText('model-a1')
  await page.keyboard.press('ArrowDown')
  await expect(selectedModel).toContainText('model-a2')
  await page.keyboard.press('ArrowUp')
  await expect(selectedModel).toContainText('model-a1')
  await page.keyboard.press('Escape')
  await expect(modelMenu).toHaveCount(0)

  await page.keyboard.press('Tab')
  const providerMenu = chat.locator('[role="listbox"][data-selection-menu="provider"]')
  await expect(providerMenu).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(harness(page)).toHaveAttribute('data-active-provider', 'provider-b')

  await chat.locator('[data-selection-trigger="model"]').click()
  await expect(chat.locator('[role="listbox"][data-selection-menu="model"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await chat.locator('[data-selection-trigger="provider"]').click()
  await expect(chat.locator('[role="listbox"][data-selection-menu="provider"]')).toBeVisible()
})

test('Tab and Ctrl+P menus work before any conversation exists', async ({ page }) => {
  await page.goto('/?providerStream=1')
  await page.getByTestId('reopen-island').click()
  await islandExpandedChatButton(page).click()

  const chat = page.locator('.janus-island .janus-chat')
  await expect(chat).toHaveClass(/janus-chat--empty/)
  // The empty-state wrapper must not clip the pop-up menu (visibility checks
  // alone cannot catch overflow clipping).
  await expect(chat.locator('.janus-chat-input-wrapper')).toHaveCSS('overflow', 'visible')
  await page.keyboard.press('Control+P')
  await expect(chat.locator('[role="listbox"][data-selection-menu="model"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await chat.locator('[data-selection-trigger="provider"]').click()
  await expect(chat.locator('[role="listbox"][data-selection-menu="provider"]')).toBeVisible()
})

test('typing while the Chat root is focused does not outline the whole Chat', async ({ page }) => {
  await page.getByTestId('toggle-streaming').click()
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await islandExpandedChatButton(page).click()

  const chat = page.locator('.janus-island .janus-chat')
  const input = chat.locator('textarea')
  await chat.getByText('Shared controller message').click()
  await expect(chat).toBeFocused()
  await page.keyboard.type('outside input')

  await expect(input).toHaveValue('')
  await expect(chat).toHaveCSS('outline-style', 'none')
})

test('cancelled and non-primary pointers do not activate Island', async ({ page }) => {
  const island = page.locator('.janus-island')
  await pointer(island, 'pointerdown')
  await pointer(island, 'pointercancel')
  await pointer(island, 'pointerdown', { pointerId: 2, isPrimary: false })
  await pointer(island, 'pointerup', { pointerId: 2, isPrimary: false })
  await pointer(island, 'pointerdown', { pointerId: 3, button: 2 })
  await pointer(island, 'pointerup', { pointerId: 3, button: 2 })
  await page.waitForTimeout(500)

  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
  await expect(harness(page)).toHaveAttribute('data-double-count', '0')
})

test('cancelled nonmatching second press clears the pending first tap', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 140, y: 22, pointerId: 2 })
  await pointer(island, 'pointercancel', { x: 140, y: 22, pointerId: 2 })
  await page.waitForTimeout(500)

  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
  await expect(harness(page)).toHaveAttribute('data-double-count', '0')
})

test('dragged nonmatching second press clears the pending first tap', async ({ page }) => {
  const island = page.locator('.janus-island')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 140, y: 22, pointerId: 2 })
  await pointer(island, 'pointermove', { x: 140, y: 50, pointerId: 2 })
  await pointer(island, 'pointercancel', { x: 140, y: 50, pointerId: 2 })
  await page.waitForTimeout(500)

  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
  await expect(harness(page)).toHaveAttribute('data-double-count', '0')
})

test('delayed single activation calls the latest callback identity', async ({ page }) => {
  const island = page.locator('.janus-island')
  // 折叠态单击已直通通知中心（不走 onSingleActivate）；延迟单击仲裁的
  // 回调身份契约在 peek→收起 路径上验证。
  await page.getByTestId('open-peek').click()
  await expect(harness(page)).toHaveAttribute('data-stage', 'peek')
  await tap(island)
  // dispatchEvent 而非真实点击：真实 pointerdown 落在岛外会触发 peek 隐式收起，
  // 污染本用例要观察的延迟单击仲裁路径。
  await page.getByTestId('replace-single').dispatchEvent('click')

  await expect(harness(page)).toHaveAttribute('data-single-count', '1', { timeout: 1_000 })
  await expect(harness(page)).toHaveAttribute('data-called-version', '2')
  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
})

test('dragging does not leave a stale single activation', async ({ page }) => {
  const island = page.locator('.janus-island')
  await pointer(island, 'pointerdown', { x: 100, y: 20 })
  await pointer(island, 'pointermove', { x: 100, y: 100 })
  await pointer(island, 'pointerup', { x: 100, y: 100 })
  await page.waitForTimeout(500)

  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(harness(page)).toHaveAttribute('data-single-count', '0')
  await expect(harness(page)).toHaveAttribute('data-double-count', '0')
})

test('pinned chat survives outside click and still collapses explicitly', async ({ page }) => {
  const island = page.locator('.janus-island')
  const shell = page.locator('.janus-island-shell')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  await islandExpandedChatButton(page).click()
  await expect(shell).toHaveAttribute('data-view', 'chat')

  await island.getByRole('button', { name: 'Pin', exact: true }).click()
  await expect(shell).toHaveAttribute('data-pinned', 'true')

  // Implicit dismiss is suppressed while pinned.
  await page.mouse.click(30, 500)
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  await page.keyboard.press('Escape')
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')

  // Explicit double activation still returns to the capsule and drops the pin.
  await tap(island, { x: 110, y: 25 })
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 114, y: 27, pointerId: 3 })
  await pointer(island, 'pointerup', { x: 114, y: 27, pointerId: 3 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(shell).toHaveAttribute('data-pinned', 'false')
})

test('chat topbar drag moves the expanded panel without moving the capsule', async ({ page }) => {
  const island = page.locator('.janus-island')
  const shell = page.locator('.janus-island-shell')
  // The harness boots streaming: the collapsed capsule must already expose
  // the loading state without leaving the capsule stage.
  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(shell).toHaveAttribute('data-loading', 'true')

  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  await islandExpandedChatButton(page).click()

  const topbar = island.locator('.janus-expanded-topbar')
  const anchor = await topbar.boundingBox()
  expect(anchor).not.toBeNull()
  // Grab the brand text just right of the top-left pin control: buttons and
  // inputs opt out of the drag handle by design.
  const pinGrabBox = await island.getByRole('button', { name: 'Pin', exact: true }).boundingBox()
  expect(pinGrabBox).not.toBeNull()
  const startX = pinGrabBox!.x + pinGrabBox!.width + 10
  const startY = pinGrabBox!.y + pinGrabBox!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 120, startY + 80, { steps: 8 })
  await page.mouse.up()

  const transform = await shell.evaluate((element) => (element as HTMLElement).style.transform)
  expect(transform).toContain('120px')
  expect(transform).toContain('80px')

  // Expanded corners paint nothing outside the rounded panel and never
  // intercept clicks: the outer island body is fully pass-through.
  await expect.poll(async () => island.evaluate((element) => getComputedStyle(element).pointerEvents))
    .toBe('none')
  await expect.poll(async () => island.evaluate((element) => getComputedStyle(element).boxShadow))
    .toBe('none')

  // Collapsing clears the offset: the capsule always stays centered.
  await tap(island, { x: 110, y: 25 })
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 114, y: 27, pointerId: 3 })
  await pointer(island, 'pointerup', { x: 114, y: 27, pointerId: 3 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'collapsed')
  await expect(shell).toHaveAttribute('data-loading', 'true')
  await shell.evaluate((element) => {
    if ((element as HTMLElement).style.transform !== '') throw new Error('capsule must stay centered')
  })
})

test('island pin covers every view and the session rail collapses', async ({ page }) => {
  const island = page.locator('.janus-island')
  const shell = page.locator('.janus-island-shell')
  await tap(island)
  await page.waitForTimeout(50)
  await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
  await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  // Default view is monitor: the pin control is present without entering chat.
  await expect(shell).toHaveAttribute('data-view', 'monitor')
  const pinButton = island.getByRole('button', { name: 'Pin', exact: true })
  const brandBox = await island.locator('.janus-expanded-brand').boundingBox()
  const pinBox = await pinButton.boundingBox()
  expect(brandBox).not.toBeNull()
  expect(pinBox).not.toBeNull()
  // Pin lives top-left, ahead of the brand mark.
  expect(pinBox!.x + pinBox!.width).toBeLessThanOrEqual(brandBox!.x + 1)
  await pinButton.click()
  await expect(shell).toHaveAttribute('data-pinned', 'true')
  await page.keyboard.press('Escape')
  await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
  await island.getByRole('button', { name: 'Unpin', exact: true }).click()
  await expect(shell).toHaveAttribute('data-pinned', 'false')

  // Session rail collapse frees the discussion width and restores on expand.
  await islandExpandedChatButton(page).click()
  const chat = island.locator('.janus-chat')
  await expect(chat).toHaveClass(/janus-chat--with-sidebar/)
  await expect.poll(async () => chat.evaluate((element) => getComputedStyle(element).transitionProperty))
    .toContain('grid-template-columns')
  await chat.getByRole('button', { name: 'Collapse conversation list' }).click()
  // The rail visibly slides shut instead of jumping: mid-flight width sits
  // strictly between the open (208px) and shut (34px) tracks.
  await expect.poll(async () => chat.locator('.janus-chat-sidebar').boundingBox().then((box) => box!.width))
    .toBeLessThan(200)
  const midWidth = await chat.locator('.janus-chat-sidebar').boundingBox().then((box) => box!.width)
  expect(midWidth).toBeGreaterThan(30)
  await expect(chat).toHaveClass(/janus-chat--sidebar-collapsed/)
  await expect(chat.locator('.janus-chat-sidebar--collapsed')).toBeVisible()
  await chat.getByRole('button', { name: 'Expand conversation list' }).click()
  await expect(chat).not.toHaveClass(/janus-chat--sidebar-collapsed/)
  await expect(chat.locator('.janus-chat-sidebar-list')).toBeVisible()
})

test('notification sheet and expanded geometry stay inside desktop and compact viewports', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 720, height: 540 }]) {
    await page.setViewportSize(viewport)
    const island = page.locator('.janus-island')
    const shell = page.locator('.janus-island-shell')
    // 单击直达通知中心：island 纵向长出的通知面也必须完整落在视口内。
    await tap(island)
    await expect(shell).toHaveAttribute('data-notif', 'true', { timeout: 1_000 })
    await expect(island).toBeInViewport()
    const sheetBox = await island.boundingBox()
    expect(sheetBox).not.toBeNull()
    expect(sheetBox!.x).toBeGreaterThanOrEqual(0)
    expect(sheetBox!.x + sheetBox!.width).toBeLessThanOrEqual(viewport.width)

    await tap(island)
    await expect(shell).toHaveAttribute('data-notif', 'false', { timeout: 2_000 })
    await tap(island)
    await page.waitForTimeout(50)
    await pointer(island, 'pointerdown', { x: 104, y: 22, pointerId: 2 })
    await pointer(island, 'pointerup', { x: 104, y: 22, pointerId: 2 })
    await expect(harness(page)).toHaveAttribute('data-stage', 'expanded')
    await expect(island).toBeInViewport()

    const box = await island.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

    await page.reload()
    await expect(page.locator('.janus-island')).toBeVisible()
  }
})

test.describe('run-orb budding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?runOrbs=1')
    await expect(page.locator('.janus-island')).toBeVisible()
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')).toBeVisible({ timeout: 5000 })
  })

  async function stopCalls(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __runOrbFixture: { stopCalls: string[] } }).__runOrbFixture.stopCalls)
  }

  test('multiple running workspaces render one orb each without flipping island mode', async ({ page }) => {
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-2"]')).toBeVisible()
    // The island body no longer flips to running; run state lives on the orbs.
    await expect(page.locator('.janus-island')).toHaveAttribute('data-mode', 'order')
    await expect(page.locator('.janus-run-orbs')).toHaveAttribute('aria-label', '2 running workspaces')
  })

  test('clicking a background orb switches workspace and opens its panel', async ({ page }) => {
    await page.locator('.janus-run-orb[data-workspace-id="workspace-2"]').click()
    await expect(harness(page)).toHaveAttribute('data-active-workspace', 'workspace-2')
    const dialog = page.getByRole('dialog', { name: 'Workspace Two' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Switch to this workspace' })).toBeVisible()
  })

  test('holding Island no longer starts a run or charges the island', async ({ page }) => {
    await page.evaluate(() => (window as any).__setRunTarget('C:\\worktrees\\not-running'))
    const island = page.locator('.janus-island')
    await pointer(island, 'pointerdown', { x: 100, y: 20 })
    await page.waitForTimeout(850)
    await pointer(island, 'pointerup', { x: 100, y: 20 })

    expect(await stopCalls(page)).toEqual([])
    expect(await page.evaluate(() => (window as any).__runOrbFixture.startCalls)).toEqual([])
    await expect(island).not.toHaveClass(/is-charging|trigger-snap/)
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')).toBeVisible()
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-2"]')).toBeVisible()
  })

  test('explicit stop confirmation removes only that indicator', async ({ page }) => {
    await page.locator('.janus-run-orb[data-workspace-id="workspace-2"]').click()
    const dialog = page.getByRole('dialog', { name: 'Workspace Two' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Stop all', exact: true }).click()
    expect(await stopCalls(page)).toEqual([])
    await dialog.getByRole('button', { name: 'Confirm stop all?', exact: true }).click()

    expect(await stopCalls(page)).toEqual(['C:\\workspace-two::dev::2'])
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-2"]')).toHaveCount(0)
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')).toBeVisible()
  })

  test('one run button starts multiple worktrees without multiplying indicators', async ({ page }) => {
    const run = page.locator('[data-id="run-project"]')
    for (const path of ['C:\\worktrees\\feature-a', 'C:\\worktrees\\feature-b']) {
      await page.evaluate(path => (window as any).__setRunTarget(path), path)
      await expect(run).toHaveAttribute('aria-label', new RegExp(path.replace(/\\/g, '\\\\')))
      await run.click()
      await expect(run).toBeEnabled()
    }
    expect(await page.evaluate(() => (window as any).__runOrbFixture.startCalls)).toEqual(['C:\\worktrees\\feature-a', 'C:\\worktrees\\feature-b'])
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')).toHaveCount(1)
    await expect(page.locator('.janus-run-orb-buds, .janus-run-orb-badge, .janus-run-orb-orbit')).toHaveCount(0)
    await run.click()
    await expect(page.getByRole('status')).toContainText('already running')
    expect(await page.evaluate(() => (window as any).__runOrbFixture.startCalls.length)).toBe(2)
    await page.locator('.janus-run-orb[data-workspace-id="workspace-1"]').click()
    await expect(page.locator('.janus-run-orb-scope-label')).toContainText(['workspace-one', 'feature-a', 'feature-b'])
  })

  test('keyboard activation runs the target and launch failures remain visible', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setRunTarget('C:\\worktrees\\failed')
      ;(window as any).__runOrbFixture.failStart = true
    })
    const run = page.locator('[data-id="run-project"]')
    await run.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText('Failed to start')
    await expect(run).toBeEnabled()
    expect(await stopCalls(page)).toEqual([])
  })

  test('missing configuration opens the launcher for the selected worktree', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setRunTarget('C:\\worktrees\\unconfigured')
      ;(window as any).__runOrbFixture.noConfig = true
    })
    await page.locator('[data-id="run-project"]').click()
    await expect(page.getByRole('dialog', { name: 'Workspace launch configuration' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__runOrbFixture.startCalls)).toEqual([])
  })

  test('launch keeps the original target while worktrees switch during config loading', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__setRunTarget('C:\\worktrees\\original')
      ;(window as any).__runOrbFixture.readDelayMs = 250
    })
    const run = page.locator('[data-id="run-project"]')
    await run.click()
    await expect(run).toBeDisabled()
    await page.evaluate(() => (window as any).__setRunTarget('C:\\worktrees\\other'))
    await expect(run).toBeEnabled()
    expect(await page.evaluate(() => (window as any).__runOrbFixture.startCalls)).toEqual(['C:\\worktrees\\original'])
  })

  test('overflow opens project details and keeps the selected project visible', async ({ page }) => {
    await page.evaluate(() => (window as any).__runOrbFixture.running.push({
      id: 'C:\\workspace-three::dev::3', workspaceId: 'workspace-3', scopePath: 'C:\\workspace-three',
      pid: 333, type: 'vite', name: 'dev', startTime: new Date().toISOString(), uptime: 0,
    }))
    await page.getByRole('button', { name: '1 more running workspaces' }).click()
    await page.locator('.janus-run-orb-overflow-main').click()
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-3"]')).toBeVisible()
    await expect(page.locator('.janus-run-orb-popover-header')).toContainText('Workspace Three')
    expect(await stopCalls(page)).toEqual([])
  })

  test('actual titlebar keeps the run button and indicators apart in both themes', async ({ page }) => {
    await page.goto('/?runOrbs=1&titlebar=1')
    const run = page.locator('[data-id="run-project"]')
    await expect(page.locator('.janus-run-orb[data-workspace-id="workspace-1"]')).toBeVisible()
    await expect(page.locator('.janus-run-orb-name')).toHaveCount(0)
    const activeMark = page.locator('.janus-run-orb[data-workspace-id="workspace-1"] .janus-run-orb-dot')
    await expect(activeMark).toHaveCSS('width', '3px')
    await expect(activeMark).toHaveCSS('height', '16px')
    await page.locator('.janus-run-orb[data-workspace-id="workspace-2"]').hover()
    await expect(page.getByRole('tooltip')).toContainText('Workspace Two')
    await page.mouse.move(0, 80)
    for (const theme of ['dark', 'planche']) {
      await page.evaluate(theme => (window as any).__applyRunTheme(theme), theme)
      for (const width of [1280, 900, 720]) {
        await page.setViewportSize({ width, height: 720 })
        await expect(run).toBeVisible()
        const runBox = await run.boundingBox()
        const chipsBox = await page.locator('.janus-run-orbs').boundingBox()
        const islandBox = await page.locator('.janus-island-shell').boundingBox()
        expect(chipsBox!.x + chipsBox!.width).toBeLessThan(runBox!.x)
        expect(islandBox!.x + islandBox!.width / 2).toBeCloseTo(width / 2, 0)
        await page.screenshot({ path: `artifacts/run-controls-${theme}-${width}.png` })
      }
    }
  })
})
