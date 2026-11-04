import { randomUUID } from 'node:crypto'
import { createToolManifests, type ToolDefinition, type ToolResult } from '@janus-agent/agent-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { automationInputSchema, dailyReviewTemplate, type AutomationDraft } from '../../shared/automations'
import { automationService } from './host'

const definitions = ['list', 'get', 'propose', 'preview', 'run', 'update'].map(name => ({
  name: `automation.${name}`, actionRisk: 'inspect',
  description: name === 'propose' || name === 'update'
    ? `${name} a local read-only CODE REVIEW automation task DRAFT for user review. For notification reminders use automation_reminder instead. Does not save or enable. Input fields: optional cardId (existing container), name, workspaceId, branch (local branch), schedule (manual/daily/weekdays/weekly/interval), intervalMinutes (integer), time (HH:mm), timezone (IANA), weekday (0-6), providerId, modelId, tasks. The tasks field contains execution steps within this one scheduled task. Steps run sequentially: git first, agent.internal or agent.cli (Codex), optional command (command=diff-check), artifact last; each step has id and input=earlier step id. Omitted fields use daily review defaults. Choose the current provider/model for internal Agent. update requires id and expected revision.`
    : name === 'run' ? 'Run a previously saved, enabled automation within its fixed read-only authorization. Requires id; no unsaved configuration is accepted.'
      : `${name} saved automation tasks or preview a draft without calling models. get requires id; preview accepts input and optional id.`,
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, revision: { type: 'number' }, input: { type: 'object' } }, additionalProperties: false },
})) as ToolDefinition[]

export function attachAutomationTools(ports: ChatTurnPorts, options: {
  workspaceId: string; providerId: string; modelId: string; sessionIds: string[]; signal: AbortSignal; onDraft(draft: AutomationDraft): void;
}): void {
  const original = ports.tools
  ports.tools = {
    registry: {
      list: () => [...original.registry.list(), ...definitions],
      listManifests: () => [...(original.registry.listManifests?.() ?? createToolManifests(original.registry.list())), ...createToolManifests(definitions)],
    },
    executeFunctionCall: async (call, callerId): Promise<ToolResult> => {
      if (!definitions.some(tool => tool.name === call.call.toolName)) return original.executeFunctionCall(call, callerId)
      const startedAt = new Date().toISOString(), correlationId = call.call.correlationId ?? randomUUID()
      const result = { workspaceId: options.workspaceId, sessionId: call.sessionId, correlationId, toolName: call.call.toolName, startedAt }
      try {
        options.signal.throwIfAborted()
        if (!options.sessionIds.includes(call.sessionId)) throw new Error('Workspace session unavailable')
        const service = await automationService(), args = (call.call.input ?? {}) as { id?: string; revision?: number; input?: Record<string, unknown> }
        const method = call.call.toolName.slice('automation.'.length)
        const previous = args.id ? service.list().find(item => item.id === args.id) : undefined
        let output: unknown
        if (method === 'list') output = service.list()
        else if (method === 'get') { if (!previous) throw new Error('Task not found'); output = { definition: previous, runs: service.history(previous.id) } }
        else if (method === 'run') {
          if (!previous?.enabled) throw new Error('Save and enable this task in the automation panel before running it from chat')
          output = await service.run(previous.id, correlationId)
        } else {
          if (method === 'update' && (!previous || previous.revision !== args.revision)) throw new Error('revision_conflict: read the latest task first')
          const input = automationInputSchema.parse({ ...dailyReviewTemplate(options.workspaceId), providerId: options.providerId, modelId: options.modelId,
            ...(previous ? service.input(previous) : {}), ...args.input, enabled: previous ? args.input?.enabled ?? previous.enabled : false })
          if (method === 'preview') output = await service.preview(input, previous?.id)
          else { const draft = { input, id: previous?.id, revision: previous?.revision }; options.onDraft(draft); output = { draft, saved: false, message: 'Review, preview or save the task in the right panel.' } }
        }
        return { ...result, status: 'completed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: 'Automation operation completed', output }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ...result, status: 'failed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: message, error: message }
      }
    },
  }
}
