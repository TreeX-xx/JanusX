// S2: real project terminals, global tool splits and workspace switching.
import { expect } from 'playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, copyFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  prepareRepo, launchApp, skipGate, ensureWorkspace, ensureSidebarExpanded,
  openWorkspace, snapper, saveManifest, runRecord, sleep, AW, AH, git,
} from './record-lib.mjs';
import { PNG, downscaleBilinear } from './showcase-lib.mjs';
import { style } from './showcase-config.mjs';

const captions = {
  ready: { badge: '1', text: '项目终端，各自并行' },
  tools: { badge: '2', text: '工具区独立上下分屏' },
  switch: { badge: '3', text: '切换项目，工具与文稿留在原位' },
  return: { badge: '4', text: '回到原项目，继续工作' },
};
const drafts = {
  Atlas: { opencode: 'Add search to the task board.', pi: 'Review empty search results.' },
  Beacon: { opencode: 'Review the release checklist.', pi: 'Explain the deployment flow.' },
};
const markdown = '- [x] Keep filtering local\n- [x] Preserve task order\n- [ ] Review empty results\n';
const taskBoard = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Atlas · Task board</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f5f2;color:#293d43;font:14px/1.5 system-ui;padding:22px}header{display:flex;justify-content:space-between;align-items:center}small{font-size:10px;letter-spacing:2px;color:#7d8c8c}h1{font-size:25px;margin:4px 0 16px;font-weight:600}header span{font-size:11px;border:1px solid #cbd5cf;border-radius:12px;padding:3px 9px}input{width:100%;border:1px solid #cbd4cf;background:#fff;border-radius:7px;padding:10px 12px;color:#293d43;font:inherit;outline:none}article{background:#fff;border:1px solid #dde2dc;border-radius:8px;padding:12px 14px;margin-top:10px}article b{display:block;font-size:13px;font-weight:550}article span{font-size:11px;color:#748280}footer{font-size:11px;margin-top:14px;color:#7d8c8c}</style>
<style>@media(max-height:300px){body{padding:10px 16px}small,footer{display:none}h1{font-size:18px;margin:0 0 6px}header span{font-size:9px;padding:1px 6px}input{font-size:11px;padding:5px 9px}article{display:flex;align-items:center;justify-content:space-between;padding:5px 9px;margin-top:5px}article b{font-size:11px}article span{font-size:9px}}article[hidden]{display:none}</style>
<header><div><small>ATLAS / WORKSPACE</small><h1>Task board</h1></div><span>Local preview</span></header>
<input aria-label="Filter tasks" placeholder="Filter tasks…"><main>
<article data-title="Search tasks"><b>Search tasks</b><span>In progress · OpenCode</span></article>
<article data-title="Search empty state"><b>Search empty state</b><span>Review · Pi</span></article>
<article data-title="Release checklist"><b>Release checklist</b><span>Backlog</span></article></main>
<footer>Project preview · stays open across workspaces</footer>
<script>window.loadToken=crypto.randomUUID();document.querySelector('input').oninput=e=>{for(const card of document.querySelectorAll('article'))card.hidden=!card.dataset.title.toLowerCase().includes(e.target.value.toLowerCase())}</script></html>`;

async function createFixture(ctx) {
  const parent = process.platform === 'win32' ? process.env.PUBLIC ?? tmpdir() : tmpdir();
  const fixtureRoot = await mkdtemp(join(parent, 'janusx-workspace-'));
  ctx.fixtureRoot = fixtureRoot;
  const claudeConfig = join(fixtureRoot, 'claude-config');
  const piHome = join(fixtureRoot, '.pi', 'agent');
  const opencodeHome = join(fixtureRoot, '.config', 'opencode');
  for (const dir of [claudeConfig, piHome, opencodeHome]) await mkdir(dir, { recursive: true });
  await writeFile(join(piHome, 'settings.json'), JSON.stringify({ theme: 'light', quietStartup: true,
    defaultProvider: 'demo', defaultModel: 'demo', lastChangelogVersion: '999.0.0' }));
  await writeFile(join(piHome, 'models.json'), JSON.stringify({ providers: { demo: {
    baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', apiKey: 'demo-unused',
    models: [{ id: 'demo', name: 'Local demo' }],
  } } }));
  await mkdir(join(piHome, 'bin'));
  for (const tool of ['fd.exe', 'rg.exe']) {
    try { await copyFile(join(homedir(), '.pi', 'agent', 'bin', tool), join(piHome, 'bin', tool)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(join(opencodeHome, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json', theme: 'system', model: 'demo/demo', autoupdate: false,
    provider: { demo: { npm: '@ai-sdk/openai-compatible', name: 'Local demo',
      options: { apiKey: 'demo-unused', baseURL: 'http://127.0.0.1:9/v1' }, models: { demo: { name: 'Local demo' } } } },
  }));
  return { fixtureRoot, claudeConfig, env: { PI_CODING_AGENT_DIR: piHome, PI_OFFLINE: '1',
    OPENAI_API_KEY: 'demo-unused', NO_COLOR: '', OPENCODE_DISABLE_AUTOUPDATE: 'true' } };
}

async function buildEvidence() {
  const entry = resolve(process.env.SHOWCASE_ENTRY ?? 'out/main/index.js');
  const root = dirname(dirname(entry)), hash = createHash('sha256');
  async function visit(dir) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await visit(path);
      else { hash.update(path.slice(root.length)); hash.update(await readFile(path)); }
    }
  }
  await visit(root);
  return { entry, buildSha256: hash.digest('hex'), recordingHead: git(resolve('.'), 'rev-parse', 'HEAD').trim(),
    buildSourcesPinned: false, workingTreeDirty: Boolean(git(resolve('.'), 'status', '--porcelain').trim()), node: process.version };
}

// Only attached WebContentsViews are composited, using Electron's actual bounds.
// During a drag/menu, the product detaches guests and renders its frozen capture.
async function nativeShot(application, page) {
  const host = await application.browserWindow(page);
  const shot = async page => {
    const base = PNG.sync.read(await page.screenshot({ type: 'png' }));
    const views = await host.evaluate(async win => {
      const result = [];
      for (const view of win.contentView.children) {
        if (!view.webContents || view.webContents.isDestroyed()) continue;
        const bounds = view.getBounds();
        if (bounds.width <= 0 || bounds.height <= 0) continue;
        result.push({ bounds, png: (await view.webContents.capturePage()).toPNG().toString('base64') });
      }
      return result;
    });
    shot.captures = [];
    for (const { bounds: b, png } of views) {
      const raw = PNG.sync.read(Buffer.from(png, 'base64'));
      let pagePixels = 0;
      for (let i = 0; i < raw.data.length; i += 4) {
        if (raw.data[i] > 225 && raw.data[i + 1] > 225 && raw.data[i + 2] > 225 && raw.data[i + 3] === 255) pagePixels++;
      }
      shot.captures.push({ bounds: b, width: raw.width, height: raw.height,
        pagePixelRatio: pagePixels / (raw.width * raw.height) });
      const pixels = raw.width === b.width && raw.height === b.height ? raw.data
        : downscaleBilinear(raw.data, raw.width, raw.height, b.width, b.height);
      for (let y = 0; y < b.height; y++) {
        if (b.y + y < 0 || b.y + y >= base.height) continue;
        const left = Math.max(0, -b.x), right = Math.min(b.width, base.width - b.x);
        if (right > left) pixels.copy(base.data, ((b.y + y) * base.width + b.x + left) * 4,
          (y * b.width + left) * 4, (y * b.width + right) * 4);
      }
    }
    return PNG.sync.write(base);
  };
  shot.captures = [];
  return shot;
}

const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(taskBoard); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try { await runRecord(async ctx => {
  const fixture = await createFixture(ctx);
  const { recordingRoot, rawDir, repoPath } = await prepareRepo('workspace', { repoParent: fixture.fixtureRoot, repoName: 'Atlas' });
  ctx.recordingRoot = recordingRoot;
  const beaconPath = join(fixture.fixtureRoot, 'Beacon');
  await mkdir(beaconPath);
  git(beaconPath, 'init', '-b', 'main');
  git(beaconPath, 'config', 'user.email', 'demo@example.invalid');
  git(beaconPath, 'config', 'user.name', 'Demo');
  for (const [name, path] of [['Atlas', repoPath], ['Beacon', beaconPath]]) {
    await writeFile(join(path, 'README.md'), `# ${name}\n\nLocal showcase project.\n`);
    git(path, 'add', '-A'); git(path, 'commit', '-m', 'Prepare workspace layout demo');
  }
  const { application, page } = await launchApp(fixture.fixtureRoot, fixture.claudeConfig, { env: fixture.env });
  Object.assign(ctx, { application, page });
  // Match the native host to the renderer viewport; guest views use real DIP bounds.
  const host = await application.browserWindow(page);
  await host.evaluate((win, size) => { win.setContentSize(size.width, size.height); win.center(); }, { width: AW, height: AH });
  await skipGate(page);
  const learning = page.getByRole('dialog').filter({ hasText: '首次入门' });
  if (await learning.count()) await learning.getByRole('button', { name: '关闭', exact: true }).click();
  await ensureWorkspace(page, 'Atlas', repoPath);
  await ensureWorkspace(page, 'Beacon', beaconPath);
  await ensureSidebarExpanded(page);
  const project = page.locator('[data-pane-region="project"]');
  const tools = page.locator('[data-pane-region="tools"]');
  const tab = name => project.locator('[data-tab-id]:visible').filter({ hasText: new RegExp(`^${name}$`, 'i') });
  const ids = {};
  for (const name of ['Beacon', 'Atlas']) {
    await openWorkspace(page, name);
    ids[name] = {};
    for (const [i, cli] of ['OpenCode', 'Pi'].entries()) {
      if (i === 0) await page.getByRole('main').getByRole('button', { name: cli, exact: true }).click();
      else {
        await page.getByRole('button', { name: 'New Terminal', exact: true }).first().click();
        const item = page.getByRole('menuitem', { name: `New ${cli} terminal`, exact: true });
        await expect(item).toBeVisible(); await sleep(220);
        const b = await item.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      }
      await expect(tab(cli)).toHaveCount(1);
      ids[name][cli.toLowerCase()] = await tab(cli).getAttribute('data-tab-id');
      await sleep(4000);
    }
    for (const cli of ['opencode', 'pi']) {
      await tab(cli).click();
      const input = project.locator('.xterm-helper-textarea:visible');
      await expect(input).toHaveCount(1);
      await expect.poll(async () => project.locator('.xterm-rows:visible').innerText(), { timeout: 45000 })
        .toMatch(cli === 'opencode' ? /tab agents|ctrl\+p commands/ : /0\.0%\/.*demo/s);
      await input.focus(); await page.keyboard.insertText(drafts[name][cli]);
      await expect.poll(async () => (await project.locator('.xterm-rows:visible').innerText()).replace(/\s/g, ''))
        .toContain(drafts[name][cli].replace(/\s/g, ''));
    }
    const s = await tab('pi').boundingBox(), p = await project.locator('section[data-pane-id]:visible').boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(p.x + p.width - 24, p.y + p.height * .45, { steps: 20 }); await page.mouse.up();
    await expect(project.locator('section[data-pane-id]:visible')).toHaveCount(2);
    console.log(`${name}: two real CLI terminals ready`);
  }
  await page.locator('[data-id="tool-menu"]').click();
  await page.locator('[role="menuitem"][data-id="browser"]').click();
  const address = page.getByRole('textbox', { name: '地址栏', exact: true });
  await address.fill(origin); await address.press('Enter');
  await expect.poll(() => application.context().pages().some(p => p.url().startsWith(origin))).toBe(true);
  const browserPage = application.context().pages().find(p => p.url().startsWith(origin));
  await browserPage.getByRole('textbox', { name: 'Filter tasks' }).fill('search');
  await expect(browserPage.locator('article:visible')).toHaveCount(2);
  await page.locator('[data-id="tool-menu"]').click();
  await page.locator('[role="menuitem"][data-id="markdown"]').click();
  const scope = page.getByRole('combobox', { name: '文稿归属', exact: true });
  await scope.selectOption({ label: 'Atlas' });
  await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
  await page.getByRole('textbox', { name: '笔记标题', exact: true }).fill('Search rollout');
  await page.getByRole('textbox', { name: '笔记内容', exact: true }).fill(markdown);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const markdownTab = tools.locator('[data-tab-id^="markdown:"]');
  const browserTab = tools.locator('[data-tab-id^="browser:"]');
  await browserTab.click();
  await page.getByRole('button', { name: '收起工具区', exact: true }).click();
  console.log('Browser and Markdown prepared; starting recorded actions');
  await expect(page.locator('html')).toHaveAttribute('data-theme', style.theme);
  const frames = [], checkpoints = [];
  const shot = await nativeShot(application, page);
  const motion = snapper(page, rawDir, frames, shot, {
    motion: 4, hover: 30, click: 8, settleMs: 160, travelPixelsPerStep: 40,
  });
  const park = { x: AW - 80, y: AH - 45 };
  await page.mouse.move(park.x, park.y); await motion.snap(park, false, 180, 'ready');
  async function state() {
    return {
      projectPanes: await project.locator('section[data-pane-id]:visible').count(),
      projectTabs: await project.locator('[data-tab-id]:visible').evaluateAll(t => t.map(e => e.dataset.tabId).sort()),
      toolPanes: await tools.locator('section[data-pane-id]').evaluateAll(p => p.map(e => e.dataset.paneId)),
      toolTabs: await tools.locator('[data-tab-id]').evaluateAll(t => t.map(e => e.dataset.tabId)),
      outerRatio: await page.getByRole('separator', { name: '调整项目与工具区宽度', exact: true }).getAttribute('aria-valuenow'),
      toolRatio: await tools.locator('[role="separator"]').getAttribute('aria-valuenow'),
      scope: await scope.inputValue(), title: await page.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(),
      document: await tools.locator('.markdown-preview').innerText(),
      browser: await browserPage.evaluate(() => ({ token: window.loadToken, filter: document.querySelector('input').value,
        scrollY, cards: [...document.querySelectorAll('article')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.title) })),
      native: await host.evaluate(win => win.contentView.children
        .filter(v => v.webContents).map(v => ({ id: v.webContents.id, url: v.webContents.getURL() }))),
    };
  }
  async function checkpoint(stage, delay = 170) {
    await motion.rest(stage, delay);
    const snapshot = await state();
    expect(snapshot.projectPanes).toBe(2); expect(snapshot.toolPanes).toHaveLength(2);
    expect(snapshot.native).toHaveLength(1); expect(snapshot.browser.filter).toBe('search');
    expect(snapshot.browser.cards).toHaveLength(2); expect(snapshot.title).toBe('Search rollout');
    expect(snapshot.document).toContain('Review empty results');
    expect(shot.captures).toHaveLength(1);
    expect(shot.captures[0].pagePixelRatio).toBeGreaterThan(.5);
    expect(await page.getByRole('button', { name: 'Retry', exact: true }).count()).toBe(0);
    checkpoints.push({ stage, frame: frames.length - 1, ...snapshot, captures: shot.captures });
    console.log(`${stage}: verified frame ${frames.length - 1}`);
    return snapshot;
  }
  await motion.clickSnap(page.getByRole('button', { name: '展开工具区', exact: true }), 'tools');
  await motion.rest('tools', 120);
  const source = motion.center(await motion.box(markdownTab));
  const target = await motion.box(tools.locator('section[data-pane-id]'));
  await motion.dragTo(source.x, source.y, target.x + target.width * .55, target.y + target.height - 24, 24, 'tools');
  // Moving a tab mounts a new pane; choose its reading mode through the real UI.
  await motion.clickSnap(page.getByRole('button', { name: '折叠笔记列表', exact: true }), 'tools');
  await motion.clickSnap(page.getByRole('button', { name: '预览', exact: true }), 'tools');
  const before = await checkpoint('tools');
  const posterFrame = frames.length - 1;
  await motion.clickSnap(page.locator('.workspace-sidebar .ws').filter({ hasText: 'Beacon' }).first(), 'switch');
  await expect(project.locator(`[data-tab-id="${ids.Beacon.opencode}"]`)).toBeVisible();
  await sleep(500); const switched = await checkpoint('switch', 210);
  for (const key of ['toolPanes', 'toolTabs', 'outerRatio', 'toolRatio', 'scope', 'title', 'document', 'browser', 'native'])
    expect(switched[key], `${key} survives workspace switch`).toEqual(before[key]);
  expect(switched.projectTabs).toEqual(Object.values(ids.Beacon).sort());
  await motion.clickSnap(page.locator('.workspace-sidebar .ws').filter({ hasText: 'Atlas' }).first(), 'return');
  await expect(project.locator(`[data-tab-id="${ids.Atlas.opencode}"]`)).toBeVisible();
  await sleep(500); const returned = await checkpoint('return', 150);
  expect(returned.projectTabs).toEqual(before.projectTabs);
  expect(returned.browser).toEqual(before.browser);
  const last = frames.at(-1), first = frames[0];
  for (const opacity of [.8, .6, .4, .2, 0]) frames.push({ ...last, delay: 80, click: false, opacity, transition: 'loop-reset' });
  for (const opacity of [.2, .4, .6, .8, 1]) frames.push({ ...first, delay: 80, click: false, opacity, transition: 'loop-reset' });
  await saveManifest(recordingRoot, { name: 'feature-workspace-layout', captions, frames, posterFrame,
    createdAt: new Date().toISOString(), presentation: { framing: 'compact', theme: style.theme, background: style.background.asset, border: 12 },
    evidence: { ...await buildEvidence(), checkpoints, terminalPresets: ['opencode', 'pi'], drafts,
      promptsSubmitted: 0, accountsCopied: false, loopTransitionMs: 800, browserFixture: 'local task board', markdown } });
}); } finally { await new Promise(resolve => server.close(resolve)); }
