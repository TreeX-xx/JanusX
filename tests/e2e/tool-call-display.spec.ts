import { expect, test } from '@playwright/test'

for (const surface of ['main-chat', 'project-panel']) {
  test(`${surface} keeps live tool arguments folded and available on demand`, async ({ page }) => {
    await page.goto(surface === 'project-panel' ? '/project.html?workbench' : '/project.html')
    const chat = surface === 'project-panel' ? page.locator('.fixture-project-chat') : page.getByTestId(surface)
    await chat.locator('textarea').fill('Read the project')
    await chat.locator('textarea').press('Enter')
    await expect(chat).toContainText('Project reply in progress')
    await page.evaluate(() => {
      const fixture = (window as any).projectFixture
      const requestId = fixture.streams.at(-1).requestId
      fixture.emitAgentEvent({ type: 'tool_call_start', requestId, callId: 'read-1', toolName: 'note_read' })
      fixture.emitAgentEvent({ type: 'tool_call_ready', requestId, callId: 'read-1', toolName: 'note_read', argumentKeys: ['uri', 'maxChars'] })
      fixture.emitAgentEvent({ type: 'tool_execution_start', requestId, callId: 'read-1', toolName: 'note_read' })
    })
    const card = chat.locator('.janus-tool-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.janus-tool-card-body')).toHaveCount(0)
    await card.locator('.janus-tool-card-toggle').click()
    await expect(card.locator('.janus-tool-card-body')).toContainText('uri, maxChars')
    await page.evaluate(() => {
      const fixture = (window as any).projectFixture
      fixture.emitAgentEvent({ type: 'tool_execution_end', requestId: fixture.streams.at(-1).requestId,
        callId: 'read-1', toolName: 'note_read', status: 'completed' })
    })
    await expect(card).toHaveClass(/completed/)
    await card.locator('.janus-tool-card-toggle').click()
    await expect(card.locator('.janus-tool-card-body')).toHaveCount(0)
    await page.evaluate(() => (window as any).projectFixture.finishStream())
    await expect(chat.locator('.streaming')).toHaveCount(0)
  })
}
