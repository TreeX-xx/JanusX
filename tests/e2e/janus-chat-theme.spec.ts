import { expect, test, type Locator, type Page } from '@playwright/test'

// Note: shared feedback must not depend on its host or a particular palette — see
// .agents/notes/agent/janus-chat-feedback-parity.md
async function setTheme(page: Page, theme: string) {
  await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
}

async function expectToken(locator: Locator, property: string, token: string) {
  const expected = await locator.evaluate((element, name) => {
    if (!getComputedStyle(element).getPropertyValue(`--${name}`).trim()) throw new Error(`Missing theme token: ${name}`)
    const probe = document.createElement('span')
    probe.style.color = `var(--${name})`
    element.parentElement!.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
  await expect(locator).toHaveCSS(property, expected)
}

async function emit(page: Page, type: 'reasoning_delta' | 'text_delta' | 'stream_end', delta?: string) {
  await page.evaluate(({ type, delta }) => {
    const fixture = (window as any).projectFixture
    for (const request of fixture.streams) fixture.emitAgentEvent({ type, delta, cancelled: false, requestId: request.requestId })
  }, { type, delta })
}

async function openHosts(page: Page, theme: string) {
  await page.goto('/project.html?manual-stream')
  await setTheme(page, theme)
  await page.addStyleTag({ content: `
    .fixture-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 16px; }
    .fixture-layout > section { display: flex; flex-direction: column; min-width: 0; height: 650px; overflow: auto; background: var(--shell-pane); }
    .fixture-layout > [data-testid="task"] { display: none; }
    .fixture-layout > [data-testid="main-chat"] { position: static; width: auto; transform: none; }
    .fixture-layout .janus-chat { width: 100%; height: 100%; }
  ` })
  // Exercise the production Island ancestor selectors with the same real JanusChat
  // and controller as the plain host, without coupling this color test to dragging.
  await page.getByTestId('main-chat').evaluate(element => {
    element.classList.add('janus-island-shell')
    element.dataset.stage = 'expanded'
    element.dataset.view = 'chat'
  })
  const hosts = [page.getByTestId('main-chat'), page.getByTestId('project-panel')]
  for (const host of hosts) {
    await host.locator('.janus-chat-input').fill('Read the selected Note')
    await host.locator('.janus-chat-input').press('Enter')
    await expect(host.locator('.janus-chat-turn-status')).toBeVisible()
  }
  return hosts
}

for (const theme of ['planche', 'dark']) {
  test(`${theme}: real Island uses the shared feedback palette`, async ({ page }) => {
    await page.goto('/')
    await setTheme(page, theme)
    await page.getByTestId('reopen-island').click()
    await page.locator('.janus-island .janus-expanded-view-button[data-view="chat"]').click()
    const chat = page.locator('.janus-island-shell .janus-chat')
    await expect(chat.locator('.janus-chat-turn-status')).toBeVisible()
    await expectToken(chat.locator('.janus-chat-turn-status'), 'color', 'shell-muted')
    await expectToken(chat.locator('.janus-chat-streaming-cursor'), 'background-color', 'shell-accent')
    await expectToken(chat.locator('.janus-chat-message-content').first(), 'color', 'shell-text')
    await expectToken(chat.locator('.janus-chat-input'), 'color', 'shell-text')
  })

  test(`${theme}: two shared chat hosts share streaming feedback and live theme changes`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const hosts = await openHosts(page, theme)
    for (const host of hosts) {
      await expectToken(host.locator('.janus-chat-turn-status'), 'color', 'shell-muted')
      await expectToken(host.locator('.janus-chat-dot').first(), 'background-color', 'shell-accent')
    }
    await emit(page, 'reasoning_delta', 'Reading the Note and checking its references.\nThe discussion remains read-only.')
    // Switch palettes while both independent streams are still active.
    for (const activeTheme of [theme, theme === 'planche' ? 'dark' : 'planche']) {
      await setTheme(page, activeTheme)
      for (const host of hosts) {
        await expect(host.locator('.janus-chat-thinking-body')).toContainText('read-only')
        for (const selector of ['.janus-chat-turn-status', '.janus-chat-thinking-toggle', '.janus-chat-thinking-body pre']) {
          await expectToken(host.locator(selector), 'color', 'shell-muted')
        }
        await expectToken(host.locator('.janus-chat-turn-elapsed'), 'color', 'shell-dim')
        await expectToken(host.locator('.janus-chat-thinking'), 'border-left-color', 'shell-accent')
        await expectToken(host.locator('.janus-chat-streaming-cursor'), 'background-color', 'shell-accent')
        await expectToken(host.locator('.janus-chat-message.user .janus-chat-message-content'), 'color', 'shell-text')
        await expectToken(host.locator('.janus-chat-message-time').first(), 'color', 'shell-dim')
        await expectToken(host.locator('.janus-chat-input'), 'color', 'shell-text')
        await expectToken(host.locator('.janus-chat-input'), 'caret-color', 'shell-accent')
        const toggle = host.locator('.janus-chat-thinking-toggle')
        await toggle.hover()
        await expectToken(toggle, 'color', 'shell-accent')
        await toggle.click()
        await expect(host.locator('.janus-chat-thinking-live')).toBeVisible()
        await expectToken(host.locator('.janus-chat-thinking-live'), 'color', 'shell-muted')
        await toggle.click()
        await page.mouse.move(0, 0)
      }
    }
    await emit(page, 'text_delta', 'The Note is ready for discussion.')
    for (const host of hosts) {
      await expectToken(host.locator('.janus-chat-message.streaming .janus-chat-message-content'), 'color', 'shell-text')
      await expectToken(host.locator('.janus-chat-message.streaming .janus-chat-message-author'), 'color', 'shell-accent')
    }
    await page.screenshot({ path: test.info().outputPath(`${theme}-streaming.png`), animations: 'disabled' })
    await emit(page, 'stream_end')
    for (const host of hosts) {
      await expect(host.locator('.janus-chat-turn-status')).toHaveCount(0)
      await expect(host.locator('.janus-chat-thinking[data-streaming="false"]')).toBeVisible()
      await expectToken(host.locator('.janus-chat-thinking-toggle'), 'color', 'shell-muted')
    }
    expect(errors).toEqual([])
  })

  test(`${theme}: compact composer uses theme tokens without host stylesheet rules`, async ({ page }) => {
    await page.goto('/project.html?workbench&manual-stream')
    await setTheme(page, theme)
    const blueprint = page.locator('.fixture-project-chat')
    const input = blueprint.locator('.janus-chat-input')
    await input.fill('Continue reading')
    await expectToken(input, 'color', 'shell-text')
    await expectToken(blueprint.locator('.janus-chat-input-wrapper'), 'background-color', 'shell-pane')
    await expectToken(blueprint.locator('.janus-chat-prompt-prefix'), 'color', 'shell-accent')
    await expectToken(blueprint.locator('.janus-chat-send'), 'background-color', 'shell-accent')
    await page.screenshot({ path: test.info().outputPath(`${theme}-workbench.png`), animations: 'disabled' })
    // A reusable JanusChat must retain its composer even when a host stylesheet is absent.
    await page.evaluate(() => {
      for (const style of document.querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id]')) {
        if (style.dataset.viteDevId?.endsWith('/blueprint/blueprint.css')) style.remove()
      }
    })
    await expectToken(input, 'color', 'shell-text')
    await expect(input).toHaveCSS('min-height', '46px')
    await expectToken(blueprint.locator('.janus-chat-input-wrapper'), 'background-color', 'shell-pane')
    await expectToken(blueprint.locator('.janus-chat-send'), 'background-color', 'shell-accent')
  })
}
