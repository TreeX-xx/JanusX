// Note: .agents/notes/desktop/browser-computer-use.md
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const definitions = [
  ['list_windows', 'Find available application windows by application name.', ['app']],
  ['select_window', 'Select a window returned by list_windows for this turn.', ['window']],
  ['read_window', 'Read the selected window and get fresh element tokens.', []],
  ['screenshot', 'Save a screenshot of the selected window and return its local path and capture ID.', []],
  ['click', 'Click an element from the latest read_window in the background.', ['element']],
  ['click_at', 'Click screenshot pixel coordinates in the background, using the latest capture ID.', ['capture', 'x', 'y']],
  ['type_text', 'Insert text into a selected window element in the background.', ['element', 'text']],
  ['press_key', 'Send a key to a selected window element in the background.', ['element', 'key']],
] as const
export const computerReadTools = new Set(['list_windows', 'read_window', 'screenshot'])
export const computerTools = definitions.map(([name, description, fields]) => {
  const properties: Record<string, { type: string }> = {}
  const shape: z.ZodRawShape = {}
  for (const field of fields) {
    const coordinate = field === 'x' || field === 'y'
    properties[field] = { type: coordinate ? 'integer' : 'string' }
    shape[field] = coordinate ? z.number().int().nonnegative() : z.string().min(1).max(field === 'text' ? 16000 : 256)
  }
  const tool: Tool = { name, description, inputSchema: { type: 'object', properties, required: [...fields], additionalProperties: false } }
  return { tool, schema: z.object(shape).strict() }
})
