// Note: pinned upstream implementation, restricted to one native guest per connection.
// .agents/notes/desktop/browser-computer-use.md
import { app, webContents } from 'electron'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'

export const DEVTOOLS_VERSION = '1.12.0'
export interface DevtoolsClient {
  tools: Tool[]
  call(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>
  close(): Promise<void>
}

export function configureBrowserDebugging(): void {
  if (!app.commandLine.hasSwitch('remote-debugging-port')) app.commandLine.appendSwitch('remote-debugging-port', '0')
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

async function endpoint(): Promise<string> {
  const explicit = Number(app.commandLine.getSwitchValue('remote-debugging-port'))
  if (explicit > 0) return `http://127.0.0.1:${explicit}`
  const port = Number((await readFile(join(app.getPath('sessionData'), 'DevToolsActivePort'), 'utf8')).split('\n')[0])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Browser debugging endpoint is unavailable')
  return `http://127.0.0.1:${port}`
}

export async function checkBrowserEndpoint(): Promise<void> {
  const response = await fetch(`${await endpoint()}/json/version`, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error('Browser debugging endpoint is unavailable')
}

export async function createDevtoolsClient(contentsId: number | undefined, directory: string, workspaceRoot?: string): Promise<DevtoolsClient> {
  await mkdir(directory, { recursive: true })
  const entry = createRequire(import.meta.url).resolve('chrome-devtools-mcp')
  const metadata = JSON.parse(await readFile(createRequire(import.meta.url).resolve('chrome-devtools-mcp/package.json'), 'utf8')) as { version: string }
  if (metadata.version !== DEVTOOLS_VERSION) throw new Error(`Expected Chrome DevTools MCP ${DEVTOOLS_VERSION}; found ${metadata.version}`)
  const directoryUrl = pathToFileURL(dirname(entry) + '/').href
  // Upstream internal exports are isolated here and pinned to the tested package version.
  const [{ McpServer }, { ServerConfig }, { puppeteer }] = await Promise.all([
    import(/* @vite-ignore */ pathToFileURL(entry).href),
    import(/* @vite-ignore */ new URL('config/ServerConfig.js', directoryUrl).href),
    import(/* @vite-ignore */ new URL('third_party/index.js', directoryUrl).href),
  ])
  let browser: { disconnect(): Promise<void> } | undefined
  const config = ServerConfig.create({ cliArgs: {
    usageStatistics: false, performanceCrux: false, categoryPerformance: false, categoryMemory: false,
    categoryEmulation: false, categoryExperimentalThirdParty: false, categoryExperimentalWebmcp: false,
    javascriptEvaluation: false, fileNavigations: false, filesystemRoot: [directory, ...(workspaceRoot ? [workspaceRoot] : [])],
  }, fileArgs: {}, suppressUsageStatisticsNotice: true })
  const server = await McpServer.from(config, { browserManager: {
    ensureBrowser: async () => {
      if (!contentsId) throw new Error('Select a browser page first')
      browser ??= await puppeteer.connect({ browserURL: await endpoint(), defaultViewport: null,
        targetFilter: (target: { type(): string; _targetId: string }) => target.type() === 'browser'
          || webContents.fromDevToolsTargetId(target._targetId)?.id === contentsId })
      return browser
    },
    close: async () => { await browser?.disconnect(); browser = undefined },
    abandonPendingAttempt: () => { void browser?.disconnect(); browser = undefined },
  } })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'janusx-browser', version: '1.0.0' })
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const { tools } = await client.listTools()
    return { tools,
      call: async (name, input, signal) => await client.callTool({ name, arguments: input }, undefined, { signal, timeout: 20000 }) as CallToolResult,
      close: async () => { try { await client.close() } finally { await server.close() } },
    }
  } catch (error) { await client.close().catch(() => {}); await server.close(); throw error }
}
