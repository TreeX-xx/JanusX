// A clean, real, locally managed CPA instance. Copy immutable components only.
import { expect } from 'playwright/test';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createFixture } from './cli-fixture.mjs';
import { prepareCpaDevelopment } from '../plugins/cpa-dev.mjs';
import { prepareRepo, launchApp, ensureWorkspace, ensureSidebarExpanded, openWorkspace, runRecord, sleep } from './record-lib.mjs';
import { readyWindow, saveStill, finishStills, startPi, resizeByKeyboard, digest } from './static-lib.mjs';

const components = process.env.SHOWCASE_CPA_COMPONENTS;
if (!components) throw new Error('Set SHOWCASE_CPA_COMPONENTS to a component root containing pinned versions/v8.0.31-v1.26.5-28bde34eb33a/. No account/configuration files are copied.');
const binaryHash = '0497fe65ef8bdd796011e8df74ba91ccfde1a2ef938faf8da8be2c2a0c943d5b';
const pageHash = '57558cd023475674634a114824b014d3e5ac161f6f3791e3d86b6adab962a700';
const installed = { id: 'v8.0.31-v1.26.5-28bde34eb33a', backend: 'v8.0.31', frontend: 'v1.26.5', binaryHash, pageHash };
const binary = await readFile(join(components, 'versions', installed.id, 'cli-proxy-api.exe'));
const html = await readFile(join(components, 'versions', installed.id, 'management.html'));
expect(digest(binary)).toBe(binaryHash); expect(digest(html)).toBe(pageHash);
const portServer = createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));

await runRecord(async ctx => {
  const fixture = await createFixture(ctx);
  const localDirectory = join(fixture.fixtureRoot, 'cpa-local');
  execFileSync(process.execPath, ['plugins/cpa/build.mjs'], { windowsHide: true, stdio: 'pipe' });
  const build = await prepareCpaDevelopment(process.cwd(), localDirectory);
  execFileSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build', '--config', 'scripts/plugins/cpa-dev.config.ts', '--outDir', build.appDirectory],
    { env: { ...process.env, JANUSX_CPA_LOCAL_DIRECTORY: localDirectory }, windowsHide: true, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 });
  const { recordingRoot, repoPath } = await prepareRepo('cpa-stills', { repoParent: fixture.fixtureRoot, repoName: 'Atlas' }); ctx.recordingRoot = recordingRoot;
  const root = join(build.profile, 'janusx', 'components', 'cpa');
  const target = join(root, 'versions', installed.id); await mkdir(target, { recursive: true });
  await writeFile(join(root, 'current.json'), JSON.stringify(installed));
  await writeFile(join(target, 'cli-proxy-api.exe'), binary); await writeFile(join(target, 'management.html'), html);
  await copyFile(join(components, 'versions', installed.id, 'LICENSE'), join(target, 'LICENSE'));
  // The old test fixture's frontend license is a stub; fetch the pinned original.
  const license = await fetch('https://raw.githubusercontent.com/router-for-me/Cli-Proxy-API-Management-Center/v1.26.5/LICENSE');
  if (!license.ok) throw new Error('Cannot obtain the pinned CPA frontend license');
  await writeFile(join(target, 'MANAGEMENT-LICENSE'), await license.text());
  const { application, page } = await launchApp(fixture.fixtureRoot, fixture.claudeConfig, {
    entry: 'scripts/plugins/cpa-dev-entry.mjs', profile: build.profile,
    env: { ...fixture.env, JANUSX_CPA_LOCAL_DIRECTORY: localDirectory },
  }); Object.assign(ctx, { application, page });
  await readyWindow(application, page, 'planche');
  await ensureWorkspace(page, 'Atlas', repoPath); await ensureSidebarExpanded(page); await openWorkspace(page, 'Atlas');
  await startPi(page, 'Review which CLI accounts are connected to the local proxy.');
  expect(await page.evaluate(id => window.electron.plugins.request({ type: 'enable', id }), build.id)).toMatchObject({ ok: true });
  await page.locator('[data-id="tool-menu"]').click();
  await page.locator('[role="menuitem"]').filter({ hasText: 'CPA' }).click();
  await expect.poll(() => application.context().pages().some(p => p.url().startsWith('janusx-plugin:'))).toBe(true);
  const plugin = application.context().pages().find(p => p.url().startsWith('janusx-plugin:'));
  await plugin.getByRole('checkbox', { name: /^(Enable local CPA|启用本地 CPA)$/ }).check();
  await plugin.getByRole('spinbutton').fill(String(port));
  await plugin.getByRole('checkbox', { name: /^(Automatically check and download updates|自动检查并下载更新)$/ }).uncheck();
  await plugin.getByRole('button', { name: /^(Save and open CPA|保存并打开 CPA)$/ }).click();
  const origin = `http://127.0.0.1:${port}`;
  await expect.poll(() => application.context().pages().some(p => p.url().startsWith(origin)), { timeout: 40000 }).toBe(true);
  const web = application.context().pages().find(p => p.url().startsWith(origin));
  await expect(web.locator('input[name="cpa-management-key"]')).toBeVisible();
  // Read the new instance's own key, keep it in memory, and never print/capture it.
  await plugin.getByRole('button', { name: /^(Copy management key|复制管理密钥)$/ }).click();
  const key = await application.evaluate(({ clipboard }) => clipboard.readText());
  await web.locator('input[name="cpa-management-key"]').fill(key);
  await web.getByRole('button', { name: /^(Login|登录|连接)$/ }).click();
  await expect(web.locator('input[name="cpa-management-key"]')).toHaveCount(0);
  await expect(web.getByRole('link', { name: /^(Dashboard|仪表盘)$/ })).toBeVisible();
  await resizeByKeyboard(page.getByRole('separator', { name: '调整项目与工具区宽度', exact: true }), 'ArrowLeft', 17);
  await sleep(3500);
  const accounts = await web.locator('body').innerText();
  const assets = [await saveStill(ctx, 'feature-cpa', { managed: true, version: installed.backend + ' / ' + installed.frontend,
    binaryHash, pageHash, emptyInstance: true, pageText: accounts })];
  expect(assets[0].nativeViews).toHaveLength(2);
  await plugin.getByRole('button', { name: /^(Connection settings|连接设置)$/ }).click();
  await expect(plugin.locator('[data-cpa-settings]')).toBeVisible();
  assets.push(await saveStill(ctx, 'feature-cpa-settings', { managed: true, autoUpdate: false, port, keyVisible: false }));
  await plugin.getByRole('button', { name: /^(Stop|停止)$/ }).click();
  await finishStills(ctx, 'cpa', assets, { entry: resolve(build.appDirectory, 'main/index.js'),
    buildSha256: digest(await readFile(join(build.appDirectory, 'main/index.js'))), pluginVersion: build.version,
    officialBackend: true, officialFrontend: true, authenticationFiles: 0, requests: 0 });
});
