import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ClaudeWorkerEngine } from '../../src/main/janus/superagent/claude-worker'
import { SuperAgentWorkerBroker } from '../../src/main/janus/superagent/worker-broker'
import type { ManagedWorkerStart } from '../../src/main/janus/superagent/workers'
import { verifyWindowsProcessTree, type WindowsProcessTree } from '@janus-agent/janus-agent/superagent/native/windows-process-tree'
import { confirmDarwinGroupExit } from '../../src/main/janus/superagent/darwin-process'
import { claudeConversationFixture } from '../helpers/claude-conversation-fixture'

const binary = process.env.JANUS_SUPERAGENT_CLAUDE_BINARY ?? process.env.JANUSX_TEST_CLAUDE_BIN
const verifyExit = (tree: WindowsProcessTree) => process.platform === 'darwin'
  ? confirmDarwinGroupExit(tree[0].pid) : verifyWindowsProcessTree(tree)
describe.skipIf(!binary || !['win32', 'darwin'].includes(process.platform))('native Claude Worker with local provider', () => {
  it('discovers host tools, reports, resumes its session and confirms the owned process tree stopped', async () => {
    const f = await claudeConversationFixture(), broker = new SuperAgentWorkerBroker()
    const tools: string[] = [], events: any[] = []
    let tree: WindowsProcessTree = [], forked = false
    const grant = await broker.issue(async name => { tools.push(name); return { received: true } })
    const scratch = join(f.root, 'scratch'); await mkdir(scratch)
    const entry = process.platform === 'darwin' ? join(process.cwd(), 'out/main/worker-mcp.js') : join(scratch, 'worker.mjs')
    const source = pathToFileURL(join(process.cwd(), 'node_modules/@janus-agent/janus-agent/dist/superagent/worker-mcp.js')).href
    if (process.platform === 'win32') await writeFile(entry, `import { runWorkerMcp } from ${JSON.stringify(source)}; await runWorkerMcp();`)
    await writeFile(join(f.config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: ['local-fixture-only'], rejected: [] },
      projects: { [(await realpath(f.cwd)).replaceAll('\\', '/')]: { hasTrustDialogAccepted: true } } }))
    const options: ManagedWorkerStart = { command: binary!, cwd: await realpath(f.cwd), env: f.env, args: [], configure: async () => ({}),
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
      if (process.platform === 'darwin') {
        await expect.poll(() => worker.snapshot().turnId).toBeNull()
        await worker.managedInput('CC_DENY', null)
        await expect.poll(() => worker.snapshot().approvals.length, { timeout: 20000 }).toBe(1)
        const state = worker.snapshot()
        await worker.command({ type: 'approve', requestId: state.approvals[0].id, decision: 'decline', controlEpoch: state.controlEpoch })
        await expect.poll(() => worker.snapshot().turnId, { timeout: 15000 }).toBeNull()
        await expect(realpath(join(f.cwd, 'CC_DENY.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      await worker.dispose(); await verifyExit(tree)
      worker = new ClaudeWorkerEngine('claude-worker-resumed', () => {})
      await worker.startManaged({ ...options, threadId: thread })
      expect(forked || worker.snapshot().threadId === thread).toBe(true)
      await worker.managedInput('CC_CANCEL', null)
      await expect.poll(() => f.requests.filter(request => request.stream).length).toBeGreaterThan(2)
      expect(JSON.stringify(f.requests.at(-1)?.messages)).toContain('CC_WORKER_REPORT')
      await worker.managedInput('CC_FOLLOWUP', worker.snapshot().turnId)
      await worker.dispose(); await verifyExit(tree)
    } finally {
      await worker.dispose().catch(() => {})
      await broker.close()
      await promisify(execFile)(binary!, ['daemon', 'stop', '--any'], { cwd: f.cwd, env: f.env, windowsHide: true, timeout: 10000 }).catch(() => {})
      await f.close()
      await rm(f.root, { recursive: true, force: true })
    }
  }, 120000)
})
