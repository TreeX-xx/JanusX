// Note: feedback tools never generate reviews — see .agents/notes/blueprint/note-mcp.md
import { z } from 'zod'
import type { ToolRegistry } from '@janus-agent/agent-core'
import type { WorkspaceSuggestions } from './workspace-service'
import type { WorkspaceSuggestionSources } from './sources'

export interface SuggestionToolHost { sources: WorkspaceSuggestionSources; suggestions: WorkspaceSuggestions }
export function registerSuggestionTools(registry: ToolRegistry, host: () => SuggestionToolHost): void {
  const identity = z.string().uuid()
  for (const name of ['note.suggestions', 'note.suggestions.close'] as const) {
    if (registry.get(name)) continue
    registry.register({
      name, actionRisk: name === 'note.suggestions' ? 'read' : 'write',
      description: name === 'note.suggestions'
        ? 'Read existing Note review suggestions. noteId selects one Note; moduleId selects the module and directly owned Notes. Lists default to summaries (use noteId or summary:false for evidence). limit is 1-50 (default 20); continue using nextOffset and expectedRevision. Read current evidence before closing. No review is generated; empty results are not approval.'
        : 'Explicitly clear handled or declined current suggestions under existing workspace authorization. Pass the branch and reportRevision from the read result. This does not modify Note content or generate a review. Deferred issues remain pending; no history is retained.',
      inputSchema: { type: 'object', properties: name === 'note.suggestions'
        ? { noteId: { type: 'string' }, moduleId: { type: 'string' }, summary: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0 }, expectedRevision: { type: 'integer', minimum: 0 } }
        : { noteId: { type: 'string' }, branch: { type: 'string' }, reportRevision: { type: 'integer' }, findingIds: { type: 'array', items: { type: 'string' } } },
      ...(name === 'note.suggestions.close' ? { required: ['noteId', 'branch', 'reportRevision', 'findingIds'] } : {}), additionalProperties: false },
      async execute(args, context) {
        if (!context.workspaceRoot) throw new Error('An explicit workspace is required')
        const runtime = host()
        const target = await runtime.sources.context(context.workspaceRoot)
        if (name === 'note.suggestions') {
          const input = z.object({ noteId: identity.optional(), moduleId: identity.optional(), summary: z.boolean().optional(),
            limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().nonnegative().default(0),
            expectedRevision: z.number().int().nonnegative().optional(),
          }).strict().parse(args)
          if (input.offset > 0 && input.expectedRevision === undefined) throw new Error('Pagination requires expectedRevision from the first page')
          const view = await runtime.suggestions.read(target)
          if (input.expectedRevision !== undefined && input.expectedRevision !== view.revision) throw new Error('Suggestions changed; restart pagination')
          const moduleUri = input.moduleId ? `note://${target.repoId}/${input.moduleId}` : undefined
          const matching = view.items.filter(item => (!input.noteId || item.noteId === input.noteId)
            && (!input.moduleId || item.noteId === input.moduleId || item.source?.module === moduleUri) && (item.report || item.error))
            .sort((a, b) => a.noteId.localeCompare(b.noteId))
          const summary = input.summary ?? !input.noteId
          const page = matching.slice(input.offset, input.offset + input.limit)
          return { ...view, context: target, summary, total: matching.length,
            nextOffset: input.offset + page.length < matching.length ? input.offset + page.length : null,
            items: summary ? page.map(item => ({ noteId: item.noteId, source: item.source, availability: item.availability,
              reportRevision: item.reportRevision, error: item.error, pending: !!item.pending,
              report: item.report ? { stale: item.report.stale, coverage: item.report.coverage, findingCount: item.report.findings.length,
                findings: item.report.findings.map(finding => ({ id: finding.id, category: finding.category, summary: finding.summary, stale: finding.stale, verification: finding.verification })) } : null,
            })) : page }
        }
        const input = z.object({ noteId: identity, branch: z.string().min(1), reportRevision: z.number().int().nonnegative(), findingIds: z.array(identity).min(1).max(200) }).strict().parse(args)
        if (input.branch !== target.branch) throw new Error('Workspace branch changed; read current suggestions')
        return { result: await runtime.suggestions.close(target, input.noteId, input.reportRevision, input.findingIds) }
      },
    })
  }
}
