#!/usr/bin/env node
import { runInstalledPluginMcp } from './run-mcp'

void runInstalledPluginMcp(process.argv[2], process.argv[3]).catch(cause => {
  console.error(cause instanceof Error ? cause.message : 'The installed plugin MCP could not start.')
  process.exitCode = 1
})
