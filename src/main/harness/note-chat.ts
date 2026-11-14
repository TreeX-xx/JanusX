import { z } from 'zod'
import { NOTE_URI_RE } from '@janus-agent/harness-core'
import { NOTE_TOOL_DEFINITIONS } from '@janus-agent/node-hosts'
// Note: Janus extends the shared agentX runtime — see .agents/notes/blueprint/agentx-harness-inheritance.md
import { randomUUID } from 'node:crypto'
import { resolve, relative } from 'node:path'
import { createToolManifests, type ToolDefinition, type ToolResult } from '@janus-agent/agent-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { NoteChatEditor, hasNoteMutationIntent } from '@janus-agent/harness-node'
export { NoteChatEditor, hasNoteMutationIntent, listNoteChatChanges } from '@janus-agent/harness-node'
import { harnessNoteService } from './service'
import { NOTE_FOCUS_SCHEMA, NOTE_SCOPE_SCHEMA, resolveNoteFocus } from './note-focus'
import type { NoteChatChange, NoteFocusEvent } from '../../shared/note-chat'
import { mentionsMemoWorkspace } from '../../shared/memo-chat-target'
const rootKey = (root: string) => process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)
const fail = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)

// Note: module browsing actions and passive scope — see .agents/notes/blueprint/navigation/requirements/module-focus-navigation.md
export const NOTE_CHAT_TOOLS = [
  { name: 'note.focus', actionRisk: 'read', description: 'Request a user-directed UI action: preview a Note, enter a module, or locate a Note with its module parent. The first target (otherwise first Note) is primary; other Notes remain individually accessible in the list. May change page, selection and source preview; preserves working Notes and navigation history. Use only when the user asks to view or navigate. Returns validation/request status, not proof the UI navigated. No editing or execution.', inputSchema: NOTE_FOCUS_SCHEMA },
  { name: 'note.scope', actionRisk: 'read', description: 'Set the conversation working Notes after finding and reading them. Give each a target/reference/dependency role and reason. User pins and removals take precedence. Never changes page, selection, preview or viewport, including legacy focus parameters. This collection grants no editing or execution authority. Use note.focus for an explicit UI navigation request.', inputSchema: NOTE_SCOPE_SCHEMA },
  ...NOTE_TOOL_DEFINITIONS,
] as ToolDefinition[]

/** Per-turn host port: only Note tools bypass generic workspace write approval. */
export function attachNoteChatTools(ports: ChatTurnPorts, options: {
  conversationId: string; userText: string; signal: AbortSignal
  resources: Array<{ agentSessionId: string; workspaceId: string; workspacePath: string }>
  onChange: (change: NoteChatChange) => void
  onFocus?: (event: NoteFocusEvent) => void
}) {
  const original = ports.tools
  const editor = new NoteChatEditor(harnessNoteService)
  const authorized = !mentionsMemoWorkspace(options.userText) && hasNoteMutationIntent(options.userText)
  // Successful Note access remains visible even when the model omits a display tool.
  const accessed = new Map<string, { uri: string; title: string; role: 'target' | 'reference'; reason: string }>()
  const highlight = (root: string, notes: Array<{ uri: string; title: string }>, role: 'target' | 'reference') => {
    if (!options.onFocus || options.signal.aborted) return
    const reason = role === 'target' ? 'Updated in this conversation' : 'Read for this conversation'
    for (const note of notes) {
      const key = `${rootKey(root)}:${note.uri}`
      const previous = accessed.get(key)
      accessed.set(key, { ...note, role: previous?.role === 'target' ? 'target' : role, reason: previous?.role === 'target' ? previous.reason : reason })
    }
    const visible = [...accessed.entries()].filter(([key]) => key.startsWith(`${rootKey(root)}:note://`)).map(([, note]) => note).slice(-32)
    options.onFocus({ id: randomUUID(), conversationId: options.conversationId, workspacePath: root, mode: 'access', focus: 'none', reason, notes: visible })
  }
  const isSharedNoteTool = (name: string) => NOTE_TOOL_DEFINITIONS.some(tool => tool.name === name)
  const definitions = NOTE_CHAT_TOOLS.filter(tool => authorized || tool.actionRisk === 'read')
  ports.tools = {
    ...original,
    registry: { list: () => [...original.registry.list().filter(tool => !isSharedNoteTool(tool.name)), ...definitions],
      listManifests: () => [...(original.registry.listManifests?.() ?? createToolManifests(original.registry.list())).filter(tool => !isSharedNoteTool(tool.canonicalName)), ...createToolManifests(definitions)] },
    executeFunctionCall: async (input, callerId, signal): Promise<ToolResult> => {
      // Isolated WorkflowX children use the shared runtime policy and their own session.
      if (!options.resources.some(item => item.agentSessionId === input.sessionId)) {
        return original.executeFunctionCall(input, callerId, signal)
      }
      if (!NOTE_CHAT_TOOLS.some(tool => tool.name === input.call.toolName)) {
        const result = await original.executeFunctionCall(input, callerId, signal)
        if (input.call.toolName !== 'workspace.read' || result.status !== 'completed' || options.signal.aborted) return result
        const resource = options.resources.find(item => item.agentSessionId === input.sessionId)
        const output = result.output as { path?: string; content?: string; sha256?: string; truncated?: boolean } | undefined
        if (!resource || typeof output?.path !== 'string') return result
        const outputPath = output.path
        try {
          const path = relative(resource.workspacePath, resolve(resource.workspacePath, outputPath)).replace(/\\/g, '/')
          if (!path.startsWith('.agents/notes/') || !path.endsWith('.md')) return result
          const snapshot = await harnessNoteService.readSnapshot(resource.workspacePath)
          const entry = snapshot.entries.find(item => item.relPath.replace(/\\/g, '/') === path && item.doc)
          if (!entry) return result
          if (!entry.uri) return result
          const read = await editor.read(resource.workspacePath, entry.uri)
          highlight(resource.workspacePath, [{ uri: read.uri, title: entry.doc!.title }], 'reference')
          return { ...result, output: { ...output, uri: read.uri, expectedHash: output.sha256 ?? read.expectedHash, workspacePath: resource.workspacePath,
            stale: output.sha256 !== read.expectedHash,
            markdown: `Workspace read excerpt (re-read with note_read for complete source):\n${output.content ?? ''}` } }
        } catch { return result } // A display lookup must not turn a successful file read into failure.
      }
      const startedAt = new Date().toISOString()
      const correlationId = input.call.correlationId ?? randomUUID()
      const resource = options.resources.find(item => item.agentSessionId === input.sessionId)
      const result = { workspaceId: resource?.workspaceId ?? '', sessionId: input.sessionId, correlationId, toolName: input.call.toolName, startedAt }
      try {
        const live = ports.sessions.getSession(input.sessionId)
        if (!resource || !live || live.status !== 'running' || live.workspaceId !== resource.workspaceId || live.workspaceRoot !== resource.workspacePath) throw new Error('PERMISSION_DENIED: Note workspace session unavailable')
        if (options.signal.aborted) throw new Error('Note operation cancelled')
        let output: unknown
        if (input.call.toolName === 'note.list') output = await editor.list(resource.workspacePath, z.string().max(1000).parse(input.call.input.query ?? ''), z.string().regex(NOTE_URI_RE).optional().parse(input.call.input.relatedTo), {
          kind: z.enum(['module', 'note', 'idea', 'requirement', 'decision', 'task', 'initiative']).optional().parse(input.call.input.kind),
          module: z.string().regex(NOTE_URI_RE).optional().parse(input.call.input.module),
          moduleState: z.enum(['planned', 'partial', 'implemented', 'retired']).optional().parse(input.call.input.moduleState),
        })
        else if (input.call.toolName === 'note.read') {
          const read = await editor.readPage(resource.workspacePath, z.string().parse(input.call.input.uri), input.call.input)
          output = read
          highlight(resource.workspacePath, [{ uri: read.uri, title: read.title }], 'reference')
        }
        else if (input.call.toolName === 'note.focus' || input.call.toolName === 'note.scope') {
          const { workspaceId: _workspaceId, ...args } = input.call.input
          const event = await resolveNoteFocus(harnessNoteService, resource.workspacePath, options.conversationId, input.call.toolName === 'note.scope' ? 'scope' : 'display', args, options.userText)
          if (options.signal.aborted) throw new Error('Note operation cancelled')
          options.onFocus?.(event)
          output = { status: 'validated', notes: event.notes, action: event.action,
            navigation: options.onFocus && event.focus === 'explicit' ? 'requested' : 'not-requested',
            message: event.mode === 'scope' ? 'Working Notes update requested; page, selection and preview stay unchanged.' : 'UI intent validated. Navigation is not confirmed; the active UI may suppress it during interaction or when a target is unavailable. Working Notes, edits and execution are unchanged.' }
        } else if (input.call.toolName === 'note.write') {
          const { workspaceId: _workspaceId, ...args } = input.call.input
          const change = await editor.write(resource.workspacePath, options.conversationId, correlationId, args, authorized, options.signal)
          if (change) {
            options.onChange(change)
            highlight(resource.workspacePath, change.files, 'target')
          }
          output = change ? { status: 'applied', id: change.id, txId: change.txId, files: change.files.map(({ uri, title }) => ({ uri, title })) } : { status: 'unchanged' }
        } else throw new Error('Unknown Note tool')
        return { ...result, status: 'completed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: 'Note operation completed', output }
      } catch (error) { return { ...result, status: 'failed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: fail(error), error: fail(error) } }
    },
  }
}
