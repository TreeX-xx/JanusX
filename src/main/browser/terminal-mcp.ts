#!/usr/bin/env node
// Note: .agents/notes/desktop/browser-control.md
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectBrowserTerminal } from './terminal-connection'

async function main() {
  const file = process.env.JANUSX_BROWSER_CONNECTION
  if (!file) throw new Error('Register Browser MCP from JanusX Settings first')
  const connection = await connectBrowserTerminal(file, process.env.JANUSX_BROWSER_CLIENT ?? 'external')
  const server = new Server({ name: 'janusx-browser', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: connection.tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await connection.call(request.params.name, request.params.arguments ?? {}, extra.signal)) }] } }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } }
  })
  let closing = false
  const close = async () => { if (closing) return; closing = true; await connection.close(); await server.close() }
  process.once('SIGTERM', () => { void close() })
  process.once('SIGINT', () => { void close() })
  process.stdin.once('end', () => { void close() })
  server.onclose = () => { void close() }
  await server.connect(new StdioServerTransport())
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
