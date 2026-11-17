import { randomUUID } from 'node:crypto'
import { stat, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SuperAgentWorkerBroker } from '../../src/main/janus/superagent/worker-broker'
import { callWorkerHost } from '../../src/main/janus/superagent/worker-mcp'
import { SuperAgentNativeLogs } from '../../src/main/janus/superagent/native-log'
import { superAgentFixture } from '../helpers/superagent-fixture'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'

describe('Worker bridge capabilities and optional diagnostics', () => {
  it('enforces the structured report contract over the real stdio bridge before forwarding to the host', async () => {
    const broker = new SuperAgentWorkerBroker(), received: unknown[] = []
    const grant = await broker.issue(async (name, args) => { if (name === 'report_work') received.push(args); return { saved: true } })
    const client = new Client({ name: 'report-test', version: '1' })
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [resolve('node_modules/@janus-agent/janus-agent/dist/superagent/worker-mcp.js')],
        env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), JANUS_WORKER_ENDPOINT: grant.endpoint, JANUS_WORKER_TOKEN: grant.token } }))
      const tools = await client.listTools()
      expect(tools.tools.find(tool => tool.name === 'report_work')?.inputSchema.required).toContain('report')
      const old = await client.callTool({ name: 'report_work', arguments: { reportId: randomUUID(), kind: 'ready', summary: 'Done', text: 'Plain prose' } })
      expect(old.isError).toBe(true); expect(received).toHaveLength(0)
      const report = { reportId: randomUUID(), kind: 'ready', summary: 'Analysis delivered.', report: { completed: ['Read-only analysis'], artifacts: [], checks: [{ method: 'Execution', status: 'not_applicable', result: 'Analysis only', evidence: [] }], limitations: [], questions: [], details: '' } }
      expect((await client.callTool({ name: 'report_work', arguments: report })).isError).not.toBe(true)
      expect(received).toEqual([report])
    } finally { await client.close(); await broker.close() }
  })
  it('isolates multiple capabilities and rejects browser-origin, foreign and revoked callers', async () => {
    const broker = new SuperAgentWorkerBroker()
    try {
      const [a, b] = await Promise.all([broker.issue(async () => ({ work: 'A' })), broker.issue(async () => ({ work: 'B' }))])
      expect(await callWorkerHost(a.endpoint, a.token, 'read_work', {})).toEqual({ work: 'A' })
      expect(await callWorkerHost(b.endpoint, b.token, 'read_work', {})).toEqual({ work: 'B' })
      await expect(callWorkerHost(a.endpoint, 'forged', 'read_work', {})).rejects.toThrow('unavailable')
      const response = await fetch(a.endpoint, { method: 'POST', headers: { authorization: `Bearer ${a.token}`, origin: 'https://foreign.invalid' }, body: '{}' })
      expect(response.status).toBe(403)
      a.revoke(); await expect(callWorkerHost(a.endpoint, a.token, 'read_work', {})).rejects.toThrow('unavailable')
      expect(await callWorkerHost(b.endpoint, b.token, 'read_work', {})).toEqual({ work: 'B' })
    } finally { await broker.close() }
  })
  it('bounds native logs without deleting durable records and reports missing optional content honestly', async () => {
    const f = await superAgentFixture(), directory = join(f.root, 'native-logs'), logs = new SuperAgentNativeLogs(directory)
    try {
      const id = randomUUID(), original = join(f.root, 'original-input.txt')
      await writeFile(original, 'permanent original')
      expect(await logs.read(id)).toEqual({ available: false, text: '', truncated: false })
      await logs.append(id, { text: '中'.repeat(1_000_000) })
      expect((await logs.read(id)).truncated).toBe(true)
      expect((await stat(join(directory, `${id}.jsonl`))).size).toBeLessThanOrEqual(2 * 1024 * 1024)
      expect(await readFile(original, 'utf8')).toBe('permanent original')
    } finally { await logs.close(); await f.dispose() }
  })
})
