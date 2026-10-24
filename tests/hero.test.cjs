const { chromium } = require(process.env.JANUSX_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const pageUrl = process.env.JANUSX_PREVIEW_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const history = 'https://github.com/TreeX-X/JanusX/releases';
const installer = `${history}/download/v1.2.3/JanusX-1.2.3-x64-setup.exe`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const release = { tag_name: 'v1.2.3', assets: [{ name: 'JanusX-1.2.3-x64-setup.exe', browser_download_url: installer }] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = requestAnimationFrame;
    window.testFrameCount = 0;
    window.requestAnimationFrame = callback => original(time => { window.testFrameCount++; callback(time); });
  });
  await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(release) }));
  async function capture(name) {
    if (!process.env.JANUSX_SCREENSHOTS) return;
    fs.mkdirSync(process.env.JANUSX_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.JANUSX_SCREENSHOTS, `${name}.png`) });
  }
  async function waitForIdle() {
    let previous = -1;
    for (let attempt = 0; attempt < 25; attempt++) {
      await page.waitForTimeout(150);
      const count = await page.evaluate(() => window.testFrameCount);
      if (count === previous) return count;
      previous = count;
    }
    assert.fail('Animation did not stop drawing after settling');
  }
  try {
    await page.goto(pageUrl);
    await page.waitForFunction(() => document.body.dataset.releaseState === 'ready');
    const action = page.locator('[data-download-setup]');
    assert.equal(await action.getAttribute('href'), installer);
    const actionBounds = await action.boundingBox();
    assert.ok(actionBounds.y > 0 && actionBounds.y + actionBounds.height < 1000, 'Download action must be in the first viewport');
    await waitForIdle();
    const originalPixels = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
    await capture('hero-desktop');
    console.log('PASS first-screen direct download; entrance settles and stops drawing');

    const hero = page.locator('#hero');
    const initial = await hero.boundingBox();
    await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height * .4);
    await page.waitForTimeout(250);
    assert.notEqual(await page.locator('canvas').evaluate(canvas => canvas.toDataURL()), originalPixels, 'Pointer should displace the capsule particles');
    await page.mouse.move(20, 20);
    await waitForIdle();
    console.log('PASS pointer interaction returns to rest');

    const rest = await page.locator('#hero-particles').evaluate(canvas => canvas.toDataURL());
    await page.waitForFunction(previous => document.getElementById('hero-particles').toDataURL() !== previous, rest, { polling: 120, timeout: 12000 });
    await waitForIdle();
    console.log('PASS idle gesture redraws the eyes and the canvas sleeps again');

    const endScroll = await page.locator('#zoom-stage').evaluate(stage => stage.getBoundingClientRect().top + scrollY + innerHeight * .6 - 16);
    await page.evaluate(y => scrollTo(0, y), endScroll);
    await page.waitForFunction(() => Number(document.getElementById('hero').style.getPropertyValue('--p')) > .999);
    await waitForIdle();
    const expanded = await hero.boundingBox();
    assert.ok(Math.abs(expanded.width - 1440) <= 2, 'Expanded card should meet the viewport edges');
    assert.equal(await page.locator('.hero-workspace').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('.hero-workspace').evaluate(node => node.inert), false);
    assert.equal(await page.locator('.hero-workspace img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await capture('hero-expanded');
    for (const view of ['terminals', 'cpa', 'documents', 'overview']) {
      await page.locator(`[data-workspace="${view}"]`).click();
      await page.waitForFunction(name => document.getElementById('workspace-preview').getAttribute('src') === `assets/workspace/${name}.png`, view);
      assert.equal(await page.locator(`[data-workspace="${view}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.workspace-controls [aria-pressed="true"]').count(), 1);
      assert.match(await page.locator('.workspace-original').getAttribute('href'), new RegExp(`${view}.png$`));
      assert.equal(await page.locator('#workspace-preview').evaluate(img => img.naturalWidth), 1760);
      if (view !== 'overview') await capture(`hero-${view}`);
    }
    console.log('PASS all four real workspace views and original-image links');
    await page.route('**/assets/workspace/cpa.png', route => route.abort());
    await page.locator('[data-workspace="cpa"]').click();
    await page.waitForFunction(() => document.getElementById('workspace-caption').textContent.includes('无法加载'));
    assert.match(await page.locator('#workspace-preview').getAttribute('src'), /overview.png$/);
    assert.equal(await page.locator('[data-workspace="overview"]').getAttribute('aria-pressed'), 'true');
    await page.unroute('**/assets/workspace/cpa.png');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => Number(document.getElementById('hero').style.getPropertyValue('--p')) < .001);
    await waitForIdle();
    assert.equal(await page.locator('.hero-workspace').evaluate(node => node.inert), true);
    console.log('PASS card expands into the workspace and reverses without replay');

    for (const [width, height] of [[390, 844], [320, 740], [768, 1024]]) {
      await page.setViewportSize({ width, height });
      await waitForIdle();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await hero.evaluate(node => getComputedStyle(node).position), 'relative');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('hero-motion')), false);
      assert.equal(await page.locator('.hero-workspace').getAttribute('aria-hidden'), 'false');
      await page.locator('[data-workspace="documents"]').click();
      await page.waitForFunction(() => document.getElementById('workspace-preview').getAttribute('src').includes('documents.png'));
      assert.equal(await page.locator('.hero-workspace').evaluate(node => node.inert), false);
      await page.evaluate(() => scrollTo(0, 0));
      const bounds = await action.boundingBox();
      assert.ok(bounds.y + bounds.height < height, 'Compact download action must remain in the first viewport');
      if (width === 390) await capture('hero-mobile');
    }
    console.log('PASS three compact layouts: static scene, visible action, no overflow');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitForIdle();
    assert.equal(await hero.evaluate(node => getComputedStyle(node).position), 'relative');
    assert.equal(await page.locator('.hero-workspace').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('hero-motion')), false);
    await capture('hero-reduced-motion');
    console.log('PASS live reduced-motion preference removes the scroll stage');

    await page.route('https://api.github.com/**', route => route.abort());
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.releaseState === 'error');
    assert.equal(await action.getAttribute('href'), history);
    assert.match(await action.innerText(), /GitHub Releases/);
    console.log('PASS first-screen action falls back when release lookup fails');
    assert.deepEqual(errors, []);

    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(pageUrl);
    assert.equal(await noScript.locator('.hero-fallback').isVisible(), true);
    assert.equal(await noScript.locator('[data-download-setup]').getAttribute('href'), history);
    assert.equal(await noScript.locator('#hero').evaluate(node => getComputedStyle(node).position), 'relative');
    assert.equal(await noScript.locator('.hero-workspace').isVisible(), true);
    assert.equal(await noScript.locator('.hero-workspace').evaluate(node => node.inert), false);
    assert.equal(await noScript.locator('#workspace-preview').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await noScript.close();
    console.log('PASS no-JavaScript static capsule and download link');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
