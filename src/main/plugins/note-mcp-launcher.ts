#!/usr/bin/env node
// Stable legacy filename; downloaded plugin content never enters the application bundle.
import { runInstalledPluginMcp } from './run-mcp'
void runInstalledPluginMcp('official.blueprint', 'note').catch(() => {
  console.error('Note MCP could not start. Install and enable the compatible official Blueprint plugin in Settings > Plugins; then register Note MCP again from its settings.')
  process.exitCode = 1
})
