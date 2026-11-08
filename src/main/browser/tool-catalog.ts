// Note: .agents/notes/desktop/browser-control.md
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export function browserToolCatalog(tools: Tool[]): Tool[] {
  return tools.map((tool): Tool => ({ ...tool,
    description: `Control JanusX's visible embedded browser. Use list_pages for host pageId values; select an uncontrolled page before reading it. ${tool.description ?? ''}`,
    inputSchema: tool.name === 'new_page'
      ? { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false }
      : ['select_page', 'close_page'].includes(tool.name)
        ? { type: 'object', properties: { pageId: { type: 'integer', minimum: 1 } }, required: ['pageId'], additionalProperties: false }
        : { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {})
          .filter(([name]) => !['filePath', 'requestFilePath', 'responseFilePath'].includes(name))) },
  }))
}
