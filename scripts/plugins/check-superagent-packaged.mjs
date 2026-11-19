// Note: .agents/notes/agent/superagent-plugin-migration.md — exercise LaunchServices with an isolated userData profile.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'
import { SuperAgentStore } from '@janus-agent/janus-agent/superagent/store'
import { SuperAgentPersistence } from '@janus-agent/janus-agent/superagent/persistence'

if (process.platform !== 'darwin' || !process.argv[2]?.endsWith('.app')) throw new Error('Pass the path to a packaged JanusX.app on macOS')
const bundle = resolve(process.argv[2])
const profile = await mkdtemp(join(tmpdir(), 'janus-finder-history-')), project = join(profile, 'Project 中文')
let browser
try {
  await mkdir(project)
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const { port } = reservation.address()
  await new Promise(resolve => reservation.close(resolve))
  const endpoint = 'http://127.0.0.1:' + port
  execFileSync('/usr/bin/open', ['-n', '--stderr', join(profile, 'startup.log'), bundle, '--args', '--user-data-dir=' + profile,
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port])
  try {
    await expect.poll(() => fetch(endpoint + '/json/version').then(res => res.ok, () => false), { timeout: 30000 }).toBe(true)
  } catch (error) { console.error((await readFile(join(profile, 'startup.log'), 'utf8').catch(() => '')).slice(-3500)); throw error }
  browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  await expect.poll(() => context.pages().find(p => p.url().includes('index.html'))?.url(), { timeout: 30000 }).toBeTruthy()
  const page = context.pages().find(p => p.url().includes('index.html'))
  await page.waitForFunction(() => Boolean(window.electron?.superAgent))
  const workspaceId = await page.evaluate(async path => (await window.electron.workspace.create({ name: 'Finder history fixture', path })).id, project)
  expect(await page.evaluate(id => window.electron.superAgent.available(id), workspaceId)).toBe(false)
  const store = new SuperAgentStore(new SuperAgentPersistence(join(profile, 'janusx/superagent')))
  const text = 'Original saved before plugin installation.'
  const { input } = await store.receiveInput({ workspaceId, workspacePath: project }, { workspaceId, conversationId: 'fixture', eventId: randomUUID(), text })
  await store.close()
  expect((await page.evaluate(([id, resource]) => window.electron.superAgent.readResource(id, resource), [workspaceId, input.resourceId])).text).toBe(text)
  console.log('Verified packaged LaunchServices startup and history access without the plugin on ' + process.arch)
} finally {
  if (browser) {
    const cdp = await browser.newBrowserCDPSession().catch(() => undefined)
    await cdp?.send('Browser.close').catch(() => {})
    await browser.close().catch(() => {})
  }
  // Clean up only processes explicitly started with this unique test profile.
  const pids = () => execFileSync('/bin/ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes(bundle + '/Contents/MacOS/') && line.includes('--user-data-dir=' + profile)).map(line => Number(line.trim().split(/\s+/)[0]))
  for (const pid of pids()) try { process.kill(pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  for (let i = 0; i < 50 && pids().length; i++) await delay(100)
  if (pids().length) throw new Error('The test application did not exit. Isolated profile retained at ' + profile)
  await rm(profile, { recursive: true, force: true })
}
