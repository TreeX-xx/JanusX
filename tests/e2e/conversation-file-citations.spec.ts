import { test, expect } from '@playwright/test'

const root = 'C:/users/tree/desktop/git/janusx-superagent-automation/'
const files = [
  '.agents/notes/blueprint/agentx-harness-inheritance.md',
  'src/main/harness/execution-adapter.ts',
  'src/shared/automations.ts',
  '.agents/notes/knowledge/module.md',
  'packages/plugin-sdk/examples/agent-workflows.md',
]
const citation = (path: string) => `:codex-file-citation{path="${path}" purpose="source"}`

test('assistant file citations become readable links that open the original files', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Explain the sources'); await input.press('Enter')
  await page.evaluate(text => (window as any).codexFixture.delta(text), 'Sources: ' + files.map(path => citation(root + path)).join(' '))
  await page.evaluate(() => (window as any).codexFixture.finish())
  const answer = page.locator('.conversation-markdown').last()
  await expect(answer.getByRole('link')).toHaveCount(5)
  await expect(answer).not.toContainText('codex-file-citation')
  for (const path of files) {
    const link = answer.getByRole('link', { name: path.split('/').pop()!, exact: true })
    await expect(link).toHaveAttribute('title', root + path)
    await link.click()
  }
  expect(await page.evaluate(() => (window as any).codexFixture.calls.opens)).toEqual(files.map(path => root + path))
  await page.setViewportSize({ width: 380, height: 720 })
  expect(await answer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/conversation-citations/file-sources-narrow.png' })
})

test('streaming citation fragments stay hidden until complete and code examples stay literal', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Explain'); await input.press('Enter')
  const answer = page.locator('.conversation-markdown').last()
  for (const text of ['See :codex', '-file-citation{path="C:/fixture/', 'source.ts" purpose="source"']) {
    await page.evaluate(text => (window as any).codexFixture.delta(text), text)
    await expect(answer).toHaveText('See ')
    await expect(answer.getByRole('link')).toHaveCount(0)
  }
  await page.evaluate(() => (window as any).codexFixture.delta('} for details.'))
  await expect(answer.getByRole('link', { name: 'source.ts', exact: true })).toBeVisible()
  const example = citation('C:/fixture/example.ts')
  await page.evaluate(text => (window as any).codexFixture.delta(text), `\n\nInline: \`${example}\`\n\n\`\`\`text\n${example}\n\`\`\``)
  await page.evaluate(() => (window as any).codexFixture.finish())
  await expect(answer.getByRole('link')).toHaveCount(1)
  await expect(answer.locator('code')).toHaveText([example, example + '\n'])
})

test('unfinished citations remain visible after completion and open failures are reported', async ({ page }) => {
  await page.goto('/codex-conversation.html?initialView=conversation')
  const input = page.getByRole('combobox', { name: 'Message Codex', exact: true })
  await input.fill('Explain'); await input.press('Enter')
  const text = citation('C:/fixture/missing.ts') + ' trailing :codex-file-citation{path="unfinished'
  await page.evaluate(text => (window as any).codexFixture.delta(text), text)
  await page.evaluate(() => (window as any).codexFixture.finish())
  const answer = page.locator('.conversation-markdown').last()
  await expect(answer).toContainText('trailing :codex-file-citation{path="unfinished')
  await page.evaluate(() => { window.electron.window.openEditor = async () => { throw new Error('File unavailable') } })
  await answer.getByRole('link', { name: 'missing.ts', exact: true }).click()
  await expect(answer.getByRole('alert')).toHaveText('Error: File unavailable')
})
