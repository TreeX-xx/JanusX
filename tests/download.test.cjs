const { chromium } = require(process.env.JANUSX_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const pageUrl = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const history = 'https://github.com/TreeX-xx/JanusX/releases';
const asset = (kind, arch = 'x64') => ({ name: `JanusX-1.2.3-${arch}-${kind}.exe`, size: 104857600, browser_download_url: `${history}/download/v1.2.3/JanusX-1.2.3-${arch}-${kind}.exe` });
const release = { tag_name: 'v1.2.3', published_at: '2026-09-18T00:00:00Z', assets: [asset('setup'), asset('portable')] };

(async () => {
  const assetsPath = path.resolve(__dirname, '../assets/workspace');
  const capture = JSON.parse(fs.readFileSync(path.join(assetsPath, 'capture.json')));
  const imported = JSON.parse(fs.readFileSync(path.join(assetsPath, 'imported.json')));
  assert.equal(capture.theme, 'dark');
  assert.equal(capture.cpa.authenticationFiles, 0);
  assert.equal(capture.cpa.requests, 0);
  const overview = capture.captures.find(item => item.file === 'overview.png');
  assert.equal(overview.projectPanes, 4);
  assert.equal(overview.toolPanes, 2);
  assert.equal(overview.nativeViews, 1);
  for (const asset of [...capture.captures, ...imported.assets]) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(assetsPath, asset.file))).digest('hex'), asset.sha256);
    if (asset.theme) assert.equal(asset.theme, 'dark');
  }
  console.log('PASS seven real dark captures match recorded hashes; six-pane overview includes native CPA');
  const browser = await chromium.launch({ headless: true });
  let checks = 0;
  async function scenario(name, response, verify) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://api.github.com/**', route => response === 'offline' ? route.abort() : route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body || release) }));
    try {
      await page.goto(pageUrl);
      await page.waitForFunction(() => document.body.dataset.releaseState);
      await verify(page);
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}`); checks++;
    } finally { await page.close(); }
  }
  try {
    await scenario('exact x64 downloads and metadata', {}, async page => {
      assert.equal(await page.locator('#download-setup').getAttribute('href'), asset('setup').browser_download_url);
      assert.equal(await page.locator('#download-portable').getAttribute('href'), asset('portable').browser_download_url);
      assert.match(await page.locator('#setup-meta').innerText(), /100.0 MB/);
      assert.match(await page.locator('#release-status').innerText(), /v1.2.3/);
      assert.equal(await page.locator('.tour-shot img').count(), 6);
      for (const img of await page.locator('.tour-shot img').all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate(node => node.decode());
        const src = await img.getAttribute('src');
        assert.ok(src.startsWith('assets/workspace/'), 'Every feature must use the new dark captures');
        assert.deepEqual(await img.evaluate(node => [node.naturalWidth, node.naturalHeight]), [1760, 884]);
        assert.ok(await img.getAttribute('alt'));
        assert.equal(await img.locator('..').getAttribute('href'), src);
      }
      for (const [width, height] of [[1440, 1000], [1920, 1080], [768, 1024], [390, 844], [320, 740]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
        const boxes = await page.locator('.download-option').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
        assert.ok(width <= 640 ? boxes[1].y >= boxes[0].bottom : boxes[1].x >= boxes[0].right);
        assert.equal(await page.locator('.brand img').first().evaluate(img => img.complete && img.naturalWidth > 0), true);
        if (process.env.JANUSX_SCREENSHOTS) {
          fs.mkdirSync(process.env.JANUSX_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.JANUSX_SCREENSHOTS, `download-${width}.png`), fullPage: true });
        }
      }
      await page.getByRole('link', { name: '下载', exact: true }).click();
      assert.match(page.url(), /#downloads$/);
    });
    await scenario('missing portable and ARM exclusion', { body: { ...release, assets: [asset('setup'), asset('portable', 'arm64')] } }, async page => {
      assert.equal(await page.locator('#download-portable').getAttribute('href'), history);
      assert.match(await page.locator('#portable-meta').innerText(), /未提供/);
    });
    await scenario('404 is empty release', { status: 404 }, async page => assert.match(await page.locator('#release-status').innerText(), /暂无公开/));
    for (const response of [{ status: 403 }, { status: 500 }, 'offline', { body: {} }, { body: { ...release, assets: [{ ...asset('setup'), browser_download_url: 'https://example.com/file.exe' }] } }]) {
      await scenario(`failure fallback ${JSON.stringify(response)}`, response, async page => {
        assert.match(await page.locator('#release-status').innerText(), /暂时不可用/);
        assert.equal(await page.locator('#download-setup').getAttribute('href'), history);
      });
    }
    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(pageUrl);
    assert.equal(await noScript.locator('#download-setup').getAttribute('href'), history);
    assert.equal(await noScript.locator('noscript').isVisible(), true);
    assert.equal(await noScript.locator('.workspace-controls').isVisible(), false);
    assert.equal(await noScript.locator('.tour-shot img[src$=".png"]').count(), 6);
    await noScript.close(); checks++;
    await scenario('reduced motion keeps all feature previews static', {}, async page => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.tour-shot img[src$=".gif"]').count(), 0);
    });
    console.log(`PASS ${checks} scenarios; 5 viewport sizes; no page errors`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
