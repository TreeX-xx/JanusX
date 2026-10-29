// Showcase v3 shared record helpers: fixture, launch, sidebar, terminals, mouse-tracked snaps.
// Disposable fixture; each feature owns its model/credential setup and readiness checks.
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, parse } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { layout, style, demos } from './showcase-config.mjs';
import { sleep } from './record-motion.mjs';
export { sleep, easeInOut, easeOutExpo, snapper } from './record-motion.mjs';
const { appWidth: AW, appHeight: AH } = layout;

export { AW, AH };
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

function testEnv(homeDir) {
  const root = parse(homeDir).root;
  return {
    ...process.env,
    ELECTRON_RENDERER_URL: '',
    NODE_ENV: 'production',
    JANUSX_KNOWLEDGE_ROOT: join(homeDir, 'knowledge'),
    HOME: homeDir,
    USERPROFILE: homeDir,
    HOMEDRIVE: root.replace(/[\\/]$/, ''),
    HOMEPATH: homeDir.slice(root.length - 1),
  };
}

/** Demo repo with a few files (filetree/browser/markdown fixtures read these).
 *  `origin: true` adds a local bare remote so origin/main exists — the worktree
 *  composer defaults its start point to origin/main and refuses to create without it. */
export async function prepareRepo(tag, { origin = false, repoParent, repoName = 'demo-repo' } = {}) {
  await mkdir(resolve('.cache/showcase'), { recursive: true });
  const recordingRoot = await mkdtemp(resolve(`.cache/showcase/${tag}-`));
  const rawDir = join(recordingRoot, 'frames');
  await mkdir(rawDir, { recursive: true });
  const repoPath = join(repoParent ?? recordingRoot, repoName);
  await mkdir(join(repoPath, 'src'), { recursive: true });
  await writeFile(join(repoPath, 'a.txt'), 'hi\n');
  await writeFile(join(repoPath, 'src', 'main.ts'), 'export const app = "demo";\n');
  await writeFile(join(repoPath, 'src', 'chain.ts'), 'export function chain(a: string, b: string): string {\n  return `${a}:${b}`;\n}\n');
  await writeFile(join(repoPath, 'page.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>demo</title></head><body><h1>JanusX 内置浏览器演示页</h1></body></html>\n');
  // silence host-side noise: PowerShell ModuleAnalysisCache + app .janusX dir
  await writeFile(join(repoPath, '.gitignore'), 'Microsoft/\n.janusX/\n');
  git(repoPath, 'init', '-b', 'main');
  git(repoPath, 'config', 'user.email', 'd@x');
  git(repoPath, 'config', 'user.name', 'd');
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '-m', 'init');
  if (origin) {
    const originPath = join(recordingRoot, 'origin.git');
    await mkdir(originPath, { recursive: true });
    git(originPath, 'init', '--bare', '-b', 'main');
    git(repoPath, 'remote', 'add', 'origin', originPath);
    git(repoPath, 'push', '-u', 'origin', 'main');
  }
  return { recordingRoot, rawDir, repoPath };
}

/** Reuse local CLI logins in a disposable TEMP fixture (deleted by closeApp). */
export async function seedFixture() {
  const realHome = homedir();
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'janusx-feat-'));
  try { await copyFile(join(realHome, '.claude.json'), join(fixtureRoot, '.claude.json')); } catch {}
  try { cpSync(join(realHome, '.claude'), join(fixtureRoot, '.claude'), { recursive: true }); } catch {}
  try {
    mkdirSync(join(fixtureRoot, '.local', 'share', 'opencode'), { recursive: true });
    await copyFile(join(realHome, '.local', 'share', 'opencode', 'auth.json'), join(fixtureRoot, '.local', 'share', 'opencode', 'auth.json'));
  } catch {}
  mkdirSync(join(fixtureRoot, '.config', 'opencode'), { recursive: true });
  await writeFile(join(fixtureRoot, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model: 'opencode-go/gpt-6-luna',
  }, null, 2));
  const claudeConfig = join(fixtureRoot, 'claude-config');
  await mkdir(claudeConfig, { recursive: true });
  await writeFile(join(claudeConfig, '.claude.json'), JSON.stringify({
    hasCompletedOnboarding: true,
    theme: 'dark',
    autoUpdates: false,
  }));
  return { fixtureRoot, claudeConfig };
}

export async function launchApp(fixtureRoot, claudeConfig, {
  env = {}, entry = process.env.SHOWCASE_ENTRY ?? 'out/main/index.js', profile = join(fixtureRoot, 'user-data'),
} = {}) {
  const application = await electron.launch({
    executablePath: process.env.JANUS_ELECTRON_PATH,
    args: [resolve(entry), `--user-data-dir=${profile}`],
    env: {
      ...testEnv(fixtureRoot),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
      CLAUDE_CONFIG_DIR: claudeConfig,
      CLAUDE_CODE_SIMPLE: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      ...env,
    },
    timeout: 60000,
  });
  const page = await application.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(15000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.electron?.workspace?.create), null, { timeout: 30000 });
  await page.evaluate(() => window.electron.system.setLanguage('zh-CN')).catch(() => {});
  await page.evaluate((theme) => window.electron.theme.update(theme), style.theme).catch(() => {});
  await page.setViewportSize({ width: AW, height: AH });
  return { application, page };
}

export async function skipGate(page) {
  const gate = page.getByRole('button', { name: '稍后再说，先用本地功能' });
  await gate.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
  if (await gate.count()) await gate.click();
}

export async function ensureWorkspace(page, name, repoPath) {
  await page.evaluate((p) => window.electron.workspace.create({ name: p.name, path: p.path }), { name, path: repoPath });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.electron?.workspace?.list), null, { timeout: 30000 });
  await sleep(1500);
  await skipGate(page);
}

export async function ensureSidebarExpanded(page) {
  if (await page.getByRole('button', { name: '展开工作区侧栏' }).count()) {
    await page.getByRole('button', { name: '展开工作区侧栏' }).click().catch(() => {});
  }
  await page.getByRole('button', { name: '收起工作区侧栏' }).first().waitFor({ state: 'visible', timeout: 10000 });
}

/** Open workspace row + expand its terminal list (both no-ops when already open). */
export async function openWorkspace(page, name) {
  await page.locator('.workspace-sidebar .ws').filter({ hasText: name }).first().click();
  await sleep(1200);
  await page.getByRole('button', { name: /展开 .* 终端列表/ }).first().click().catch(() => {});
  await sleep(600);
}

/** Create a Shell terminal via empty-state card or the New Terminal menu. */
export async function newShell(page) {
  try {
    await page.getByRole('main').getByText('Shell', { exact: true }).click({ timeout: 8000 });
  } catch {
    await page.getByRole('button', { name: 'New Terminal', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New Shell terminal', exact: true }).click();
  }
  await page.locator('.xterm-helper-textarea').first().waitFor({ state: 'attached', timeout: 45000 });
  await sleep(2500);
  await rmMicrosoftJunk(page);
}

export async function rmMicrosoftJunk(page) {
  void page;
  // PowerShell drops Microsoft/ModuleAnalysisCache under cwd; caller repoPath known via evaluate is overkill —
  // best-effort no-op here, record scripts rm() their repoPath directly when needed.
}

/** Type into the focused shell and run. */
export async function shellRun(page, index, text) {
  const input = page.locator('.xterm-helper-textarea').nth(index);
  await input.focus().catch(() => {});
  await input.pressSequentially(text, { delay: 20 }).catch(() => {});
  await input.press('Enter').catch(() => {});
  await sleep(1500);
}

export async function saveManifest(recordingRoot, manifest) {
  const entry = Object.entries(demos).find(([, demo]) => demo.asset === manifest.name);
  if (!entry) throw new Error('Unknown showcase asset: ' + manifest.name);
  if (!manifest.frames?.length) throw new Error('Cannot save an empty recording');
  for (const frame of manifest.frames) {
    if (frame.cap && !manifest.captions?.[frame.cap]) throw new Error('Missing caption: ' + frame.cap);
  }
  manifest = { ...manifest, schemaVersion: 1, feature: entry[0], delayUnit: 'ms',
    viewport: { width: AW, height: AH },
    canvas: manifest.presentation?.framing === 'compact'
      ? { FW: AW + 24, FH: AH + 24 } : { FW: layout.width, FH: layout.height },
    count: manifest.frames.length };
  await writeFile(join(recordingRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(resolve('.cache/showcase', entry[0] + '-latest.json'), JSON.stringify({ dir: recordingRoot }, null, 2));
  console.log(`Recorded ${manifest.name}: ${manifest.count} frames -> ${recordingRoot}`);
}

export async function closeApp(application, fixtureRoot) {
  try { await application?.close(); } catch {}
  if (!fixtureRoot) return;
  const target = resolve(fixtureRoot);
  const parents = [resolve(tmpdir())];
  if (process.platform === 'win32' && process.env.PUBLIC) parents.push(resolve(process.env.PUBLIC));
  if (!parents.includes(parse(target).dir) || !parse(target).base.startsWith('janusx-')) {
    throw new Error('Refusing fixture cleanup outside a JanusX demo directory: ' + target);
  }
  await rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
}

/** Wrap a record main(): error shot + cleanup. Returns recordingRoot on success. */
export async function runRecord(main) {
  const ctx = { application: null, fixtureRoot: null, page: null, recordingRoot: null };
  try {
    await main(ctx);
  } catch (error) {
    console.error(error);
    if (ctx.page && ctx.recordingRoot) {
      try { console.log((await ctx.page.locator('body').innerText()).slice(-4000)); } catch {}
      await ctx.page.screenshot({ path: join(ctx.recordingRoot, 'capture-error.png') }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    await closeApp(ctx.application, ctx.fixtureRoot);
    if (ctx.recordingRoot) console.log(`Done: ${ctx.recordingRoot}`);
  }
  return ctx.recordingRoot;
}
