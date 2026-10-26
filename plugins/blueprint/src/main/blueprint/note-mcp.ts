#!/usr/bin/env node
// Note: standalone original-Note access; no desktop or generation dependencies — see .agents/notes/blueprint/note-mcp.md
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createNoteMcpServer } from './note-mcp-server'
import { migrateLegacyData } from '../legacy-data'

async function start() {
  const directory = process.env.JANUSX_PLUGIN_STATE_ROOT, applicationDataDirectory = process.env.JANUSX_PLUGIN_APPLICATION_DATA_DIRECTORY
  if (directory && applicationDataDirectory) await migrateLegacyData({ directory, applicationDataDirectory,
    allowLegacyImport: process.env.JANUSX_PLUGIN_ALLOW_LEGACY_IMPORT !== '0' })
  const host = createNoteMcpServer()
  process.once('SIGTERM', () => { void host.close().finally(() => process.exit(0)) })
  process.once('SIGINT', () => { void host.close().finally(() => process.exit(0)) })
  await host.server.connect(new StdioServerTransport())
}
void start().catch(() => { console.error('Note MCP failed to start; legacy state was preserved. Check plugin settings.'); process.exitCode = 1 })
