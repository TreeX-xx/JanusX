// Note: Pi adapts the same host tools through its native extension API — .agents/notes/desktop/browser-control.md
import { fileURLToPath } from 'node:url'
import { connectBrowserTerminal } from './terminal-connection'

interface PiAPI {
  registerTool(tool: { name: string; label: string; description: string; parameters: unknown; executionMode: 'sequential'; execute(id: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> }): void
  on(event: string, handler: () => Promise<void>): void
}
export default async function registerBrowser(pi: PiAPI) {
  // This bundle is copied next to the host descriptor; no dependency on Pi's package layout.
  const connection = await connectBrowserTerminal(fileURLToPath(new URL('./connection.json', import.meta.url)), 'pi')
  for (const tool of connection.tools) pi.registerTool({ name: `janusx_browser_${tool.name}`, label: `Browser: ${tool.name}`,
    description: tool.description ?? tool.name, parameters: tool.inputSchema, executionMode: 'sequential',
    execute: async (_id, input, signal) => {
      try { return { content: [{ type: 'text', text: JSON.stringify(await connection.call(tool.name, input, signal)) }] } }
      catch (error) { throw new Error(error instanceof Error ? error.message : String(error)) }
    },
  })
  pi.on('session_shutdown', () => connection.close())
}
