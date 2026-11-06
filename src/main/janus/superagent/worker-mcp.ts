#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { request as httpRequest } from 'node:http'

const object = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })
export const WORKER_MCP_TOOLS = [
  { name: 'report_work', description: 'Persist a ready, question or failure report for your assigned work. Use a stable UUID reportId when retrying the same report. A ready report does not stop your turn. Include changes, checks actually run and remaining limitations.',
    inputSchema: object({ reportId: { type: 'string', format: 'uuid' }, kind: { enum: ['ready', 'question', 'failure'] }, summary: { type: 'string' }, text: { type: 'string' } }, ['reportId', 'kind', 'summary', 'text']) },
  { name: 'read_work', description: 'Read your assigned work card, sourced constraints, uncovered inputs, environment and report references. Page inputs/reports/executions with offset; constraints with constraintOffset. Identity is supplied by the host.',
    inputSchema: object({ offset: { type: 'integer', minimum: 0 }, constraintOffset: { type: 'integer', minimum: 0 }, textOffset: { type: 'integer', minimum: 0 }, sourceOffset: { type: 'integer', minimum: 0 }, intentRevision: { type: 'integer', minimum: 0 } }, []) },
  { name: 'read_resource', description: 'Read an original input or report belonging to your assigned work. Large material can be read in successive pages.',
    inputSchema: object({ resourceId: { type: 'string', format: 'uuid' }, offset: { type: 'integer', minimum: 0 }, version: { type: 'string', pattern: '^[a-f0-9]{64}$' }, reread: { type: 'boolean', description: 'Only for an intentional reread after compaction.' } }, ['resourceId']) },
  { name: 'commit_work', description: 'Request a host-controlled Git commit for explicit relative file paths. The user reviews the exact message and paths. This tool waits for that decision. No push, merge, branch or worktree changes are included.',
    inputSchema: object({ requestId: { type: 'string', format: 'uuid' }, message: { type: 'string' }, paths: { type: 'array', items: { type: 'string' }, minItems: 1 } }, ['requestId', 'message', 'paths']) },
] as const

export function callWorkerHost(endpoint: string, token: string, tool: string, args: unknown): Promise<unknown> {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return Promise.reject(new Error('Worker host must use local loopback'))
  const body = JSON.stringify({ tool, arguments: args })
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', agent: false, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
      response.setEncoding('utf8')
      let data = ''
      response.on('data', chunk => { data += chunk; if (data.length > 8 * 1024 * 1024) request.destroy(new Error('Worker host response is too large')) })
      response.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (response.statusCode !== 200) reject(new Error(result.error ?? 'Worker host rejected the request'))
          else resolve(result)
        } catch (error) { reject(error) }
      })
    })
    request.setTimeout(15 * 60 * 1000, () => request.destroy(new Error('Worker host request timed out; no action will be replayed')))
    request.on('error', reject)
    request.end(body)
  })
}

export async function runWorkerMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const endpoint = env.JANUS_WORKER_ENDPOINT, token = env.JANUS_WORKER_TOKEN
  if (!endpoint || !token) throw new Error('Managed worker connection is unavailable')
  const server = new Server({ name: 'janus-worker', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...WORKER_MCP_TOOLS] }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (!WORKER_MCP_TOOLS.some(tool => tool.name === request.params.name)) throw new Error('Unknown worker tool')
    try {
      const result = await callWorkerHost(endpoint, token, request.params.name, request.params.arguments ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] } }
  })
  await server.connect(new StdioServerTransport())
  await callWorkerHost(endpoint, token, '__heartbeat', {})
  const heartbeat = setInterval(() => {
    void callWorkerHost(endpoint, token, '__heartbeat', {}).catch(() => { clearInterval(heartbeat); void server.close(); process.exitCode = 1 })
  }, 5000)
  process.stdin.once('end', () => { clearInterval(heartbeat); void server.close() })
}

if (process.argv[1]?.endsWith('worker-mcp.js')) void runWorkerMcp().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1 })
