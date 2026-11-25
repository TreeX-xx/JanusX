import { test, expect } from '@playwright/test'
const artifacts = process.env.JANUS_EMPHASIS_ARTIFACTS ?? 'artifacts/inline-code-color-20261113'

test('answer emphasis saves per theme, survives reload, and resets without changing other colors', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/theme-settings.html?emphasis')
  const setting = page.getByRole('group', { name: 'Content accent color', exact: true })
  const hex = setting.getByRole('textbox', { name: 'Content accent color hex value' })
  const reset = setting.getByRole('button', { name: 'Reset to default' })
  const output = page.getByRole('region', { name: 'Conversation output' })
  const emphasis = output.getByText('important_field', { exact: true })
  await expect(setting.getByText('Follow theme')).toBeVisible()
  await expect(hex).toHaveValue('#89BFFE')
  await hex.focus(); await hex.press('Tab')
  await expect(reset).toBeDisabled()
  const originalLink = await output.locator('a').first().evaluate(el => getComputedStyle(el).color)
  await hex.fill('#c8a8f4'); await hex.press('Enter')
  await expect(emphasis).toHaveCSS('color', 'rgb(200, 168, 244)')
  await expect(setting.getByText('Custom color')).toBeVisible()
  await expect(output.locator('a strong')).toHaveCSS('color', originalLink)
  for (const region of [output, page.getByRole('region', { name: 'Chat output' })]) {
    for (const code of await region.locator(':not(pre) > code').all()) await expect(code).toHaveCSS('color', 'rgb(200, 168, 244)')
    for (const plain of await region.locator('strong, em, a').all()) {
      const parentColor = await plain.evaluate(el => getComputedStyle(el.parentElement!).color)
      await expect(plain).toHaveCSS('color', parentColor)
    }
    await expect(region.getByText('important details')).toHaveCSS('font-weight', '600')
    await expect(region.locator('a').first()).toHaveCSS('text-decoration-line', 'underline')
    for (const block of await region.locator('pre > code').all()) await expect(block).toHaveCSS('color', originalLink)
  }
  await page.reload()
  await expect(hex).toHaveValue('#C8A8F4')
  await expect(emphasis).toHaveCSS('color', 'rgb(200, 168, 244)')
  await page.locator('input[value="white"]').locator('..').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'white')
  await expect(setting.getByText('Follow theme')).toBeVisible()
  await expect(hex).toHaveValue('#1A4F95')
  await hex.fill('#375d8b'); await hex.press('Tab')
  await expect(emphasis).toHaveCSS('color', 'rgb(55, 93, 139)')
  await hex.fill('invalid'); await hex.press('Enter')
  await expect(hex).toHaveAttribute('aria-invalid', 'true')
  await expect(emphasis).toHaveCSS('color', 'rgb(55, 93, 139)')
  await hex.press('Escape')
  await expect(hex).toHaveValue('#375D8B')
  await reset.click()
  await expect(setting.getByText('Follow theme')).toBeVisible()
  await expect(reset).toBeDisabled()
  await setting.locator('..').screenshot({ path: `${artifacts}/settings-white.png` })
  await page.locator('input[value="dark"]').locator('..').click()
  await expect(hex).toHaveValue('#C8A8F4')
  await page.screenshot({ path: `${artifacts}/settings-dark.png`, fullPage: true })
  await page.setViewportSize({ width: 320, height: 800 })
  await setting.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const label = await page.getByText('Content accent color', { exact: true }).boundingBox()
  const controls = await setting.boundingBox()
  expect(label!.y + label!.height).toBeLessThan(controls!.y)
  await setting.locator('..').screenshot({ path: `${artifacts}/settings-narrow.png` })
})

test('swatch and hex form one control and the preview separates weight from code color in three themes', async ({ page }) => {
  await page.goto('/theme-settings.html?emphasis')
  const setting=page.getByRole('group',{name:'Content accent color',exact:true})
  const preview=setting.getByRole('group',{name:'Text appearance preview'})
  const picker=setting.getByLabel('Choose content accent color'), hex=setting.getByRole('textbox',{name:'Content accent color hex value',exact:true})
  for(const theme of ['dark','white','planche']) {
    await page.locator(`input[value="${theme}"]`).locator('..').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme)
    await expect(preview.getByText('Key content',{exact:true})).toHaveCSS('font-weight','600')
    const plain=await preview.evaluate(el=>getComputedStyle(el).color)
    await expect(preview.locator('strong')).toHaveCSS('color',plain)
    expect(await preview.locator('code').evaluate(el=>getComputedStyle(el).color)).not.toBe(plain)
    const geometry=await picker.evaluate(el=>{
      const color=el.getBoundingClientRect(), text=el.nextElementSibling!.getBoundingClientRect()
      return {sameParent:el.nextElementSibling?.tagName==='INPUT',offset:Math.abs(color.y+color.height/2-text.y-text.height/2)}
    })
    expect(geometry.sameParent).toBe(true); expect(geometry.offset).toBeLessThanOrEqual(1)
    await setting.locator('..').screenshot({path:`${artifacts}/color-control-${theme}.png`})
  }
  await hex.fill('#6485AB'); await hex.press('Enter')
  await expect(preview.locator('code')).toHaveCSS('color','rgb(100, 133, 171)')
  await page.setViewportSize({width:320,height:800})
  await setting.scrollIntoViewIfNeeded()
  expect(await setting.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
  await setting.screenshot({path:`${artifacts}/color-control-narrow.png`})
})

test('Worker settings navigation opens plugin management when the SuperAgent page is unavailable', async ({ page }) => {
  await page.goto('/host-boundary.html')
  await page.getByRole('button',{name:'Settings',exact:true}).waitFor()
  await page.evaluate(() => window.dispatchEvent(new Event('janusx:open-worker-settings')))
  await expect(page.locator('[data-tab="plugins"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-tab="agent"]')).not.toHaveAttribute('aria-current', 'page')
})

test('color picker and other-window changes update the mounted output and file previews', async ({ page, context }) => {
  await page.goto('/theme-settings.html?emphasis')
  const picker = page.getByLabel('Choose content accent color', { exact: true })
  await expect(picker).toBeEnabled()
  const inlineCode = page.getByRole('region', { name: 'Conversation output' }).getByText('important_field', { exact: true })
  const defaultColor = await inlineCode.evaluate(el => getComputedStyle(el).color)

  const previews = await Promise.all(['embedded', 'floating'].map(async host => {
    const preview = await context.newPage()
    await preview.goto(`/editor-preview.html${host === 'embedded' ? '?embedded' : ''}`)
    const editor = preview.locator(`[data-editor-host="${host}"]`)
    await expect(editor).toBeVisible()
    await preview.evaluate(() => (window as any).previewHarness.open('accent.md', 'A paragraph with **emphasis** and `field_name`.'))
    await expect(editor.locator('[data-editor-tab][data-active=true]')).toHaveText('accent.md')
    const mode = editor.getByRole('radio', { name: '预览', exact: true })
    await mode.click()
    const markdown = editor.locator('.markdown-preview')
    return { mode, code: markdown.locator('code'), strong: markdown.locator('strong') }
  }))
  for (const { mode, code, strong } of previews) {
    await expect(mode).toBeChecked()
    await expect(mode).toHaveCSS('color', defaultColor)
    await expect(code).toHaveCSS('color', defaultColor)
    await expect(strong).toHaveCSS('color', defaultColor)
  }

  await picker.evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#74c7b8')
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(inlineCode).toHaveCSS('color', 'rgb(116, 199, 184)')
  for (const { mode, code, strong } of previews) {
    await expect(mode).toHaveCSS('color', 'rgb(116, 199, 184)')
    await expect(code).toHaveCSS('color', 'rgb(116, 199, 184)')
    await expect(strong).toHaveCSS('color', 'rgb(116, 199, 184)')
    expect(await mode.evaluate(el => getComputedStyle(el, '::after').backgroundColor)).toBe('rgb(116, 199, 184)')
  }
  const other = await context.newPage()
  await other.goto('/theme-settings.html?emphasis')
  await expect(other.getByLabel('Content accent color hex value')).toHaveValue('#74C7B8')
  await other.getByLabel('Content accent color hex value').fill('#fab')
  await other.getByLabel('Content accent color hex value').press('Enter')
  await expect(page.getByLabel('Content accent color hex value')).toHaveValue('#FFAABB')
  await expect(inlineCode).toHaveCSS('color', 'rgb(255, 170, 187)')
  for (const { mode, code } of previews) {
    await expect(mode).toHaveCSS('color', 'rgb(255, 170, 187)')
    await expect(code).toHaveCSS('color', 'rgb(255, 170, 187)')
  }
  await other.getByRole('button', { name: 'Reset to default' }).click()
  await expect(inlineCode).toHaveCSS('color', defaultColor)
  for (const { mode, code } of previews) {
    await expect(mode).toHaveCSS('color', defaultColor)
    await expect(code).toHaveCSS('color', defaultColor)
  }
  await other.close()
})
