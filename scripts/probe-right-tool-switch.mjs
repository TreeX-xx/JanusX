// Real Electron/workspace stress probe. Does not mock IPC or alter repository files.
import { _electron as electron } from '@playwright/test'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const output = resolve(process.argv[2] || 'artifacts/right-switch-live')
const count = Number(process.argv[3] || 600)
if (!Number.isInteger(count) || count < 1) throw new Error('Switch count must be a positive integer')
const workspace = resolve(process.argv[4] || '.')
const build = resolve(process.env.RIGHT_SWITCH_BUILD || 'artifacts/right-switch-build')
await mkdir(join(output, 'profile/janusx/workspaces'), { recursive: true })
await copyFile(join(process.env.APPDATA, 'janusx/janusx/agent-sessions.json'), join(output, 'profile/janusx/agent-sessions.json'))
await writeFile(join(output, 'profile/janusx/workspaces/probe.json'), JSON.stringify({
  id: 'probe', name: 'JanusX', path: workspace, clis: [], layout: { mode: 'tabs', positions: [] },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}))
await writeFile(join(output, 'profile/janusx/config.json'), JSON.stringify({ theme: 'dark', themeMigratedToSlate: true, experimentalFeatures: { sessions: true, persona: true } }))
const application = await electron.launch({ args: [join(build, 'main/index.js'), `--user-data-dir=${join(output, 'profile')}`],
  env: { ...process.env, ELECTRON_RENDERER_URL: '', NODE_ENV: 'production', JANUSX_KNOWLEDGE_ROOT: join(output, 'knowledge') }, timeout: 60000 })
const errors = []
application.process().stderr.on('data', data => { if (errors.length < 500) errors.push(String(data)) })
try {
  const page = await application.firstWindow({ timeout: 60000 })
  page.on('pageerror', error => errors.push(String(error)))
  await page.waitForLoadState('domcontentloaded')
  await page.addInitScript(() => localStorage.setItem('janusx:learning:v1', JSON.stringify({ version: 1, introduced: true })))
  await page.reload()
  await page.locator('#right-tool-rail-files').waitFor({ timeout: 60000 })
  await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const metrics = { ipc: [], events: [], lag: [], started: Date.now() }
    globalThis.__switchMetrics = metrics
    // Test-only wrapping of Electron's registered handlers; preserve all results/errors.
    for (const [channel, original] of [...ipcMain._invokeHandlers]) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args) => {
        const start = Date.now()
        try { return await original(...args) }
        finally { metrics.ipc.push({ channel, start, duration: Date.now() - start }) }
      })
    }
    for (const window of BrowserWindow.getAllWindows()) {
      const send = window.webContents.send.bind(window.webContents)
      window.webContents.send = (channel, ...args) => {
        metrics.events.push({ channel, start: Date.now() })
        return send(channel, ...args)
      }
    }
    let previous = Date.now()
    globalThis.__switchLagTimer = setInterval(() => {
      const now = Date.now()
      if (now - previous > 40) metrics.lag.push({ start: previous, duration: now - previous - 20 })
      previous = now
    }, 20)
  })
  await application.evaluate(async () => {
    const { Session } = process.getBuiltinModule('inspector')
    const session = new Session()
    session.connect()
    const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
    globalThis.__switchProfiler = { session, post }
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 2000 })
    await post('Profiler.start')
  })
  // Open actual panels and give real provider import a chance to finish.
  for (const id of ['files', 'git', 'sessions']) {
    await page.locator(`#right-tool-rail-${id}`).click()
    await page.locator(`#right-tool-panel-${id}:not([hidden])`).waitFor()
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: join(output, 'workspace.png') })
  const dataset = await page.evaluate(async workspace => ({ url: location.href, tools: [...document.querySelectorAll('[data-rail-tool]')].map(el => el.getAttribute('data-rail-tool')), sessionCards: document.querySelectorAll('[data-session-id]').length, nodes: document.querySelectorAll('*').length,
    gitFiles: document.querySelectorAll('[class*="fileRow"]').length, gitCommits: document.querySelectorAll('[class*="commitRow"]').length,
    workspaceSessions: (await window.electron.session.list({ cwd: workspace })).length, totalSessions: (await window.electron.session.list({ includeArchived: true })).length }), workspace)
  console.log('WORKSPACE', dataset)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 2000 })
  await cdp.send('Profiler.start')
  await page.evaluate(() => {
    const metrics = { frames: [], longTasks: [], animationFrames: [], switches: [], start: performance.timeOrigin, running: true }
    window.__switchMetrics = metrics
    let last = performance.now()
    const frame = now => { if (!metrics.running) return; metrics.frames.push({ start: last, duration: now - last }); last = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    for (const [type, key] of [['longtask', 'longTasks'], ['long-animation-frame', 'animationFrames']]) {
      if (PerformanceObserver.supportedEntryTypes.includes(type)) new PerformanceObserver(list => {
        for (const entry of list.getEntries()) metrics[key].push(entry.toJSON())
      }).observe({ type, buffered: false })
    }
  })
  let seed = 20261024
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const tools = await page.locator('[data-rail-tool]').evaluateAll(elements => elements.map(el => el.getAttribute('data-rail-tool')))
  let previous = 'sessions'
  for (let index = 0; index < count; index++) {
    const candidates = tools.filter(id => id !== previous)
    const target = candidates[Math.floor(random() * candidates.length)]
    const dwell = 340 + Math.floor(random() * 280)
    // Real pointer input; measure from the renderer's actual click event, not driver latency.
    await page.evaluate(({ index, target }) => {
      const button = document.querySelector(`[data-rail-tool="${target}"]`)
      button.addEventListener('click', () => {
        const entry = { index, target, start: performance.now(), epoch: Date.now(), committed: null, painted: null }
        window.__switchMetrics.switches.push(entry)
        const sample = () => {
          if (button.getAttribute('aria-pressed') === 'true') {
            entry.committed = performance.now() - entry.start
            requestAnimationFrame(() => { entry.painted = performance.now() - entry.start })
          } else if (performance.now() - entry.start < 5000) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, { once: true })
    }, { index, target })
    await page.locator(`[data-rail-tool="${target}"]`).click({ timeout: 5000 })
    await page.waitForTimeout(dwell)
    previous = target
    if ((index + 1) % 50 === 0) console.log('PROGRESS', index + 1, await page.evaluate(() => ({ longTasks: window.__switchMetrics.longTasks.length, maxFrame: Math.max(...window.__switchMetrics.frames.map(frame => frame.duration)), failed: window.__switchMetrics.switches.filter(item => item.painted === null).length })))
  }
  const { profile } = await cdp.send('Profiler.stop')
  await writeFile(join(output, 'renderer.cpuprofile'), JSON.stringify(profile))
  const mainProfile = await application.evaluate(async () => {
    const { session, post } = globalThis.__switchProfiler
    const { profile } = await post('Profiler.stop')
    session.disconnect()
    return profile
  })
  await writeFile(join(output, 'main.cpuprofile'), JSON.stringify(mainProfile))
  const renderer = await page.evaluate(() => { window.__switchMetrics.running = false; return window.__switchMetrics })
  const main = await application.evaluate(() => { clearInterval(globalThis.__switchLagTimer); return globalThis.__switchMetrics })
  const sorted = values => [...values].sort((a, b) => a - b)
  const distribution = values => { const list = sorted(values); return { count: list.length, p50: list[Math.floor(list.length * .5)], p95: list[Math.floor(list.length * .95)], p99: list[Math.floor(list.length * .99)], max: list.at(-1) } }
  const captureStart = renderer.start + renderer.frames[0].start
  const summary = { workspace, dataset, seed: 20261024, switches: renderer.switches.length, unfinished: renderer.switches.filter(item => item.painted === null).length,
    captureMs: renderer.frames.at(-1).start + renderer.frames.at(-1).duration - renderer.frames[0].start,
    commitMs: distribution(renderer.switches.map(item => item.committed).filter(value => value !== null)),
    paintMs: distribution(renderer.switches.map(item => item.painted).filter(value => value !== null)),
    framesMs: distribution(renderer.frames.map(item => item.duration)), framesOver50: renderer.frames.filter(item => item.duration > 50).length,
    longTasks: renderer.longTasks.length, mainLag: distribution(main.lag.map(item => item.duration)),
    steadyMainLag: distribution(main.lag.filter(item => item.start >= captureStart).map(item => item.duration)),
    byTool: Object.fromEntries(tools.map(tool => [tool, distribution(renderer.switches.filter(item => item.target === tool && item.painted !== null).map(item => item.painted))])),
    slowestSwitches: [...renderer.switches].sort((a, b) => b.painted - a.painted).slice(0, 20),
    ipc: Object.fromEntries([...new Set(main.ipc.map(item => item.channel))].map(channel => [channel, distribution(main.ipc.filter(item => item.channel === channel).map(item => item.duration))])),
  }
  await writeFile(join(output, 'measurements.json'), JSON.stringify({ renderer, main, errors }))
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('RESULT', JSON.stringify(summary))
  if (summary.unfinished) throw new Error(`${summary.unfinished} switches did not finish`)
} catch (error) {
  for (const [index, page] of application.windows().entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {})
    await writeFile(join(output, `failure-${index}.txt`), await page.locator('body').innerText().catch(() => '')).catch(() => {})
  }
  await writeFile(join(output, 'errors.json'), JSON.stringify({ error: String(error), logs: errors }, null, 2))
  throw error
} finally {
  await application.close()
}

