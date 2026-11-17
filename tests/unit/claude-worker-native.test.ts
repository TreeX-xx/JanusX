import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ClaudeWorkerEngine } from '../../src/main/janus/superagent/claude-worker'
import { SuperAgentWorkerBroker } from '../../src/main/janus/superagent/worker-broker'
import type { ManagedWorkerStart } from '../../src/main/janus/superagent/workers'
import { verifyWindowsProcessTree, type WindowsProcessTree } from '@janus-agent/janus-agent/superagent/native/windows-process-tree'
import { claudeConversationFixture } from '../helpers/claude-conversation-fixture'

const binary = process.env.JANUSX_TEST_CLAUDE_BIN
describe.skipIf(!binary || process.platform !== 'win32')('native Claude Worker with local provider', () => {
  it('discovers host tools, reports, resumes its session and confirms the owned process tree stopped', async () => {
    const f = await claudeConversationFixture(), broker = new SuperAgentWorkerBroker()
    const tools: string[] = [], events: any[] = []
    let tree: WindowsProcessTree = [], forked = false
    const grant = await broker.issue(async name => { tools.push(name); return { received: true } })
    const scratch = join(f.root, 'scratch'); await mkdir(scratch)
    const entry = join(scratch, 'worker.mjs')
    const source = pathToFileURL(join(process.cwd(), 'node_modules/@janus-agent/janus-agent/dist/superagent/worker-mcp.js')).href
    await writeFile(entry, `import { runWorkerMcp } from ${JSON.stringify(source)}; await runWorkerMcp();`)
    await writeFile(join(f.config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: ['local-fixture-only'], rejected: [] },
      projects: { [f.cwd.replaceAll('\\', '/')]: { hasTrustDialogAccepted: true } } }))
    const options: ManagedWorkerStart = { command: binary!, cwd: f.cwd, env: f.env, args: [], configure: async () => ({}),
      onForkedThread: async () => { forked = true }, onEvent: event => events.push(event), onProcessTree: async value => { tree = structuredClone(value) },
      worker: { backend: 'claude', lease: {} as any, scratchPath: scratch, bridge: { command: process.execPath, entry, ...grant } } }
    let worker = new ClaudeWorkerEngine('claude-worker-fixture', () => {})
    try {
      await worker.startManaged(options)
      await expect.poll(() => tools.includes('__tools_discovered'), { timeout: 30000 }).toBe(true)
      const thread = worker.snapshot().threadId!
      expect(tree.length).toBeGreaterThan(0)
      await worker.managedInput('CC_WORKER_REPORT', null)
      await expect.poll(() => tools.includes('report_work'), { timeout: 30000 }).toBe(true)
      await expect.poll(() => events.some(event => event.method === 'turn/completed'), { timeout: 15000 }).toBe(true)
      expect(f.requests.some(request => request.stream)).toBe(true)
      await worker.dispose(); await verifyWindowsProcessTree(tree)
      worker = new ClaudeWorkerEngine('claude-worker-resumed', () => {})
      await worker.startManaged({ ...options, threadId: thread })
      expect(forked || worker.snapshot().threadId === thread).toBe(true)
      await worker.managedInput('CC_CANCEL', null)
      await expect.poll(() => f.requests.filter(request => request.stream).length).toBeGreaterThan(2)
      expect(JSON.stringify(f.requests.at(-1)?.messages)).toContain('CC_WORKER_REPORT')
      await worker.managedInput('CC_FOLLOWUP', worker.snapshot().turnId)
      await worker.dispose(); await verifyWindowsProcessTree(tree)
    } finally {
      await worker.dispose().catch(() => {})
      await broker.close()
      await promisify(execFile)(binary!, ['daemon', 'stop', '--any'], { cwd: f.cwd, env: f.env, windowsHide: true, timeout: 10000 }).catch(() => {})
      await f.close()
      await rm(f.root, { recursive: true, force: true })
    }
  }, 120000)
})
