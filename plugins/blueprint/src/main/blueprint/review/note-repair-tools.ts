// Note: repair tools cannot write outside the selected Note — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import { createToolManifests, type ToolDefinition, type ToolResult } from '@janus-agent/agent-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { resolve } from 'node:path'
import type { NoteRepairPlan, NoteRepairPhase, NoteRepairUpdate } from '../../../shared/note-repair'
import type { NoteRepairService } from './note-repair'

export function attachNoteRepairTools(ports: ChatTurnPorts, options: {
  service: NoteRepairService; plan: NoteRepairPlan; signal: AbortSignal
  resources: Array<{ workspaceId: string; workspacePath: string; agentSessionId: string }>
  phase(phase: NoteRepairPhase, changed?: boolean, afterHash?: string, changes?: NoteRepairUpdate['changes']): void
}): string[] {
  const original = ports.tools
  const definitions: ToolDefinition[] = [{ name: 'note.repair_read', actionRisk: 'read',
    description: 'Read the actual selected repair target, including malformed source. Follow nextOffset until all relevant source is read. The target is fixed by the host; no path or URI argument.',
    inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 500, maximum: 12000 } }, additionalProperties: false } },
    ...(options.plan.intent === 'repair' ? [{ name: 'note.repair_write', actionRisk: 'write' as const,
      description: 'Fix only the selected issues in the one host-authorized Note. Supply complete Markdown source including frontmatter and exact expectedHash from repair_read. Preserve identity, creation date, lifecycle, contracts and unrelated content. The host validates format and prevents concurrent overwrites. Completion is independently verified after the turn.',
      inputSchema: { type: 'object' as const, properties: { markdown: { type: 'string' }, expectedHash: { type: 'string' }, reason: { type: 'string' } }, required: ['markdown', 'expectedHash', 'reason'], additionalProperties: false } },
      { name: 'note.repair_block', actionRisk: 'read' as const,
        description: 'Report a concrete evidence gap or missing business decision that prevents correcting the selected Note. This does not write the Note or resolve suggestions. Use only when supported corrections cannot be made; reading and analysis alone are not completion.',
        inputSchema: { type: 'object' as const, properties: { reason: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['reason'], additionalProperties: false } }] : [])]
  const allowed = original.registry.list().filter(tool => tool.actionRisk === 'read')
  const names = new Set([...allowed, ...definitions].map(tool => tool.name))
  const samePath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
  ports.tools = {
    registry: { list: () => [...allowed, ...definitions], listManifests: () => createToolManifests([...allowed, ...definitions]) },
    executeFunctionCall: async (input, callerId): Promise<ToolResult> => {
      const resource = options.resources.find(item => item.agentSessionId === input.sessionId)
      const startedAt = new Date().toISOString(), toolName = input.call.toolName
      const base = { workspaceId: resource?.workspaceId ?? '', sessionId: input.sessionId,
        correlationId: input.call.correlationId ?? options.plan.id, toolName, startedAt }
      try {
        const live = ports.sessions.getSession(input.sessionId)
        if (!names.has(toolName) || !resource || !live || live.status !== 'running' || live.workspaceId !== resource.workspaceId
          || !samePath(resource.workspacePath, options.plan.context.workspacePath) || !samePath(live.workspaceRoot, resource.workspacePath)) throw new Error('This repair can only read evidence and modify its selected Note')
        options.signal.throwIfAborted()
        if (!toolName.startsWith('note.repair_')) return original.executeFunctionCall(input, callerId)
        const { workspaceId: _workspaceId, ...args } = input.call.input
        if (toolName !== 'note.repair_block') options.phase(toolName === 'note.repair_write' ? 'editing' : 'reading')
        const output = toolName === 'note.repair_write' ? await options.service.write(options.plan.id, args, options.signal)
          : toolName === 'note.repair_block' ? options.service.block(options.plan.id, args) : await options.service.read(options.plan.id, args)
        if (toolName === 'note.repair_write' && (output as { status?: string }).status === 'applied') {
          const written = output as { expectedHash: string; changes?: NoteRepairUpdate['changes'] }
          options.phase('editing', true, written.expectedHash, written.changes)
        }
        return { ...base, status: 'completed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: 'Note repair operation completed', output }
      } catch (error) {
        if (toolName === 'note.repair_write') options.service.recordWriteFailure(options.plan.id, error)
        const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
        return { ...base, status: 'failed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: message, error: message }
      }
    },
  }
  return [...names]
}
