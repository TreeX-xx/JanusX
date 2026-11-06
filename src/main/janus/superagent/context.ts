// Note: source-backed cards and bounded recall — see .agents/notes/agent/superagent-context.md
import { z } from 'zod'
import type { SuperAgentResource } from '../../../shared/superagent'
import { inspectCheckout } from '../../git/controlled-worktree'
import type { SuperAgentEnvironments } from './environments'
import type { SuperAgentStore } from './store'
import { contextUpdateSchema, SuperAgentContextStore } from './context-store'
import { resourcePage } from './context-reader'
import { estimateContextTokens } from '@janus-agent/chat-core'

export const cardQuerySchema = z.object({ offset: z.number().int().nonnegative().safe().default(0),
  constraintOffset: z.number().int().nonnegative().safe().default(0), textOffset: z.number().int().nonnegative().safe().default(0),
  sourceOffset: z.number().int().nonnegative().safe().default(0),
  intentRevision: z.number().int().nonnegative().safe().optional() }).strict()
export const resourceQuerySchema = z.object({ resourceId: z.string().uuid(), offset: z.number().int().nonnegative().safe().default(0),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(), reread: z.boolean().optional().describe('Deliberate reread after compaction; otherwise follow the returned continuation.') }).strict()
export const resourceRef = (resource: SuperAgentResource) => ({ resourceId: resource.id, version: resource.sha256, resourceKind: resource.kind, bytes: resource.bytes })
const excerpt = (text: string, chars: number) => ({ text: text.slice(0, chars), truncated: text.length > chars })
const pageInfo = (total: number, offset: number, size: number) => ({ total, offset, end: Math.max(offset, Math.min(total, offset + size)),
  truncated: offset > 0 || offset + size < total, nextOffset: offset + size < total ? offset + size : null })

/** One projection/reader for Janus and the capability-bound Worker. No model or expiry policy. */
export class SuperAgentContext {
  readonly interpretations: SuperAgentContextStore
  constructor(readonly store: SuperAgentStore, private readonly environments?: SuperAgentEnvironments) {
    this.interpretations = new SuperAgentContextStore(store.directory)
  }
  private async semantic(workspaceId: string) {
    try {
      const entries = (await this.interpretations.snapshot()).filter(row => row.workspaceId === workspaceId), records = await this.store.snapshot(workspaceId)
      for (const entry of entries) {
        const linked = new Set(records.deliveries.filter(row => row.workId === entry.workId).map(row => row.inputId)), covered = new Set(entry.coveredInputIds)
        if (!records.works.some(row => row.id === entry.workId) || [...covered].some(id => !linked.has(id))
          || [entry.goal, ...entry.constraints].some(claim => claim.sourceInputIds.some(id => !covered.has(id)))) throw new Error('Work context has unresolved input references; original file preserved. Read original inputs instead.')
      }
      return { entries, diagnostic: undefined as string | undefined }
    }
    catch (error) { return { entries: [], diagnostic: String(error) } }
  }
  async update(workspaceId: string, value: unknown) {
    const input = contextUpdateSchema.parse(value), detail = await this.store.workDetail(workspaceId, input.workId)
    if (detail.work.revision !== input.expectedWorkRevision) throw new Error('Work changed; read its current card before updating context')
    const ids = new Set(detail.inputs.map(row => row.id)), covered = new Set(input.coveredInputIds)
    if (covered.size !== input.coveredInputIds.length || [...covered].some(id => !ids.has(id))) throw new Error('Context coverage must name distinct inputs of this work')
    if ([input.goal, ...input.constraints].some(claim => claim.sourceInputIds.some(id => !covered.has(id)))) throw new Error('Every interpretation must cite covered original inputs')
    return this.interpretations.put(workspaceId, input)
  }
  async interpretation(workspaceId: string, workId: string) { return (await this.semantic(workspaceId)).entries.find(row => row.workId === workId) }
  async read(workspaceId: string, value: unknown, maxTokens = Infinity, workId?: string, maxBytes = Infinity) {
    const input = resourceQuerySchema.parse(value)
    const records = workId ? await this.store.workDetail(workspaceId, workId) : await this.store.snapshot(workspaceId)
    const resource = records.resources.find(row => row.id === input.resourceId)
    if (!resource) throw new Error(workId ? 'Resource is outside this assigned work' : 'Resource is outside this workspace')
    const ref = resourceRef(resource)
    if (input.version && input.version !== resource.sha256) return { status: 'version-mismatch' as const, ...ref, text: '', diagnostic: 'Read the current reference; the requested version is not available.' }
    try { return resourcePage(await this.store.readResource(workspaceId, input.resourceId), input.offset, maxTokens, maxBytes) }
    catch (error) {
      const cause = error instanceof Error ? error.cause as NodeJS.ErrnoException | undefined : undefined
      return { status: cause?.code === 'ENOENT' ? 'missing' as const : 'unavailable' as const, ...ref, text: '',
        diagnostic: String(error), recovery: 'Original content is unavailable. Do not infer it from a summary; explain the gap and recover the original before dependent work.' }
    }
  }
  async list(workspaceId: string, query = '', offset = 0, size = 20) {
    z.number().int().nonnegative().safe().parse(offset)
    const records = await this.store.snapshot(workspaceId), semantic = await this.semantic(workspaceId)
    const search = query.trim().toLocaleLowerCase()
    const matches = records.works.filter(work => {
      if (!search) return true
      const context = semantic.entries.find(row => row.workId === work.id)
      const inputs = records.deliveries.filter(row => row.workId === work.id).map(row => row.inputId)
      const refs = [work.id, work.title, work.goal, context?.goal.text, ...(context?.aliases ?? []), ...(context?.files ?? []),
        ...records.inputs.filter(row => inputs.includes(row.id)).flatMap(row => [row.id, row.resourceId, row.conversationId]),
        ...records.reports.filter(row => row.workId === work.id).flatMap(row => [row.id, row.resourceId]),
        ...records.executions.filter(row => row.workId === work.id).flatMap(row => [row.id, row.instanceId, row.providerSessionId, row.cwd])]
      return refs.filter(Boolean).join('\n').toLocaleLowerCase().includes(search)
    }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    return { workspaceId, revision: records.revision, ...pageInfo(matches.length, offset, size), diagnostic: semantic.diagnostic,
      works: matches.slice(offset, offset + size).map(work => {
        const context = semantic.entries.find(row => row.workId === work.id)
        return { id: work.id, workId: work.id, title: work.title, goal: (context?.goal.text ?? work.goal).slice(0, 600), goalTruncated: (context?.goal.text ?? work.goal).length > 600,
          revision: work.revision, contextRevision: context?.revision ?? 0, closedAt: work.closedAt, latestReportId: work.latestReportId,
          sourceInputId: work.sourceInputId, aliases: context?.aliases.slice(0, 5), files: context?.files.slice(0, 5) }
      }) }
  }
  async card(workspaceId: string, workId: string, value: unknown = {}, maxTokens = Infinity) {
    const { offset, constraintOffset, textOffset, sourceOffset, intentRevision } = cardQuerySchema.parse(value), detail = await this.store.workDetail(workspaceId, workId)
    const semantic = await this.semantic(workspaceId), interpretation = semantic.entries.find(row => row.workId === workId)
    if (intentRevision !== undefined && intentRevision !== (interpretation?.revision ?? 0)) throw new Error('Interpretation version changed; read the current card before continuing')
    const covered = new Set(interpretation?.coveredInputIds ?? [])
    const ref = (id: string) => resourceRef(detail.resources.find(row => row.id === id)!)
    const source = detail.inputs.find(row => row.id === detail.work.sourceInputId)!
    const latest = detail.reports.find(row => row.id === detail.work.latestReportId) ?? detail.reports.at(-1)
    const report = latest && { id: latest.id, executionId: latest.executionId, kind: latest.kind, receivedAt: latest.receivedAt,
      summary: latest.summary.slice(0, 1200), summaryTruncated: latest.summary.length > 1200, ...ref(latest.resourceId),
      currentExecution: latest.executionId === detail.work.latestExecutionId, coverageKnown: latest.availableInputIds !== undefined,
      availableInputCount: latest.availableInputIds?.length, availableInputIds: latest.availableInputIds?.slice(-20),
      coverageTruncated: (latest.availableInputIds?.length ?? 0) > 20 }
    const inputs = await Promise.all([...detail.inputs].reverse().slice(offset, offset + 20).map(async input => ({
      id: input.id, sequence: input.sequence, conversationId: input.conversationId, receivedAt: input.receivedAt, ...ref(input.resourceId),
      interpreted: covered.has(input.id), availableAtLatestReport: latest?.availableInputIds?.includes(input.id) ?? false,
      delivery: detail.deliveries.find(row => row.inputId === input.id),
      original: await this.read(workspaceId, { resourceId: input.resourceId }, 120, workId),
    })))
    const environments = await this.environments?.store.snapshot(workspaceId)
    const environment = environments?.environments.filter(row => row.workId === workId).at(-1)
    let current: { status: string; path?: string; branch?: string; head?: string; dirty?: boolean; diagnostic?: string } = { status: 'unassigned' }
    if (environment) {
      current = { status: 'reclaimed', path: environment.checkout.path }
      if (environment.removedAt === null) {
        try {
          const actual = await inspectCheckout(environment.checkout.path)
          current = { status: actual.directoryIdentity === environment.checkout.directoryIdentity && actual.repositoryIdentity === environment.checkout.repositoryIdentity ? 'available' : 'identity-changed',
            path: actual.path, branch: actual.branch, head: actual.head, dirty: actual.dirty }
        } catch (error) { current = { status: 'unavailable', diagnostic: String(error) } }
      }
    }
    const constraints = interpretation?.constraints ?? []
    const claim = (item: { text: string; sourceInputIds: string[] }) => ({ text: item.text.slice(textOffset, textOffset + 1200),
      offset: Math.min(textOffset, item.text.length), end: Math.min(textOffset + 1200, item.text.length), total: item.text.length,
      truncated: textOffset > 0 || textOffset + 1200 < item.text.length, rangeUnit: 'UTF-16 code units',
      continuation: textOffset + 1200 < item.text.length ? { workId, constraintOffset, textOffset: textOffset + 1200, intentRevision: interpretation?.revision ?? 0 } : null,
      sourceInputIds: item.sourceInputIds.slice(sourceOffset, sourceOffset + 20), sourcesPage: pageInfo(item.sourceInputIds.length, sourceOffset, 20) })
    const card = { workId, work: { ...detail.work, goal: detail.work.goal.slice(0, 2400), goalTruncated: detail.work.goal.length > 2400 },
      source: { inputId: source.id, ...ref(source.resourceId) },
      intent: { provenance: interpretation ? 'janus-interpretation' : 'creation-goal; read original constraints', revision: interpretation?.revision ?? 0,
        updatedAt: interpretation?.updatedAt, goal: claim(interpretation?.goal ?? { text: detail.work.goal, sourceInputIds: [source.id] }),
        constraints: constraints.slice(constraintOffset, constraintOffset + 20).map(claim), constraintsPage: pageInfo(constraints.length, constraintOffset, 20),
        coveredInputCount: covered.size, uncoveredInputCount: detail.inputs.filter(row => !covered.has(row.id)).length,
        stale: detail.inputs.some(row => !covered.has(row.id)), diagnostic: semantic.diagnostic,
        aliases: interpretation?.aliases.slice(constraintOffset, constraintOffset + 20), aliasesPage: pageInfo(interpretation?.aliases.length ?? 0, constraintOffset, 20),
        files: interpretation?.files.slice(constraintOffset, constraintOffset + 20), filesPage: pageInfo(interpretation?.files.length ?? 0, constraintOffset, 20), referencesAreFilePermissions: false },
      environment: environment && { id: environment.id, workId, createdAt: environment.createdAt, removedAt: environment.removedAt,
        baseRef: environment.baseRef, baseCommit: environment.baseCommit, checkout: { path: environment.checkout.path, branch: environment.checkout.branch, head: environment.checkout.head } },
      checkout: { recorded: environment && { path: environment.checkout.path, branch: environment.checkout.branch, head: environment.checkout.head },
        current, evidencePolicy: 'Reports and code references describe historical evidence. Verify the current branch, HEAD and code before implementation.' },
      report, inputCount: detail.inputs.length, inputs, inputsPage: pageInfo(detail.inputs.length, offset, 20),
      reports: [...detail.reports].reverse().slice(offset, offset + 20).map(row => ({ id: row.id, executionId: row.executionId, kind: row.kind, ...excerpt(row.summary, 160), ...ref(row.resourceId) })),
      reportsPage: pageInfo(detail.reports.length, offset, 20),
      executions: [...detail.executions].reverse().slice(offset, offset + 20), executionsPage: pageInfo(detail.executions.length, offset, 20),
      coverageMeaning: 'Available/delivered and summary coverage are not proof of semantic incorporation or completion. A ready report is Worker evidence, not independent verification.' }
    // Shrink optional history before requirements. Every omitted row keeps a continuation.
    const pages = [
      [card.reports, card.reportsPage], [card.executions, card.executionsPage],
      [card.intent.aliases ?? [], card.intent.aliasesPage], [card.intent.files ?? [], card.intent.filesPage],
      [card.inputs, card.inputsPage], [card.intent.constraints, card.intent.constraintsPage],
    ] as const
    for (const [rows, page] of pages) {
      while (rows.length > 1 && estimateContextTokens(JSON.stringify(card)) > maxTokens) rows.pop()
      page.end = page.offset + rows.length; page.nextOffset = page.end < page.total ? page.end : null
      page.truncated = page.offset > 0 || page.end < page.total
    }
    return card
  }
  close() { return this.interpretations.close() }
}
