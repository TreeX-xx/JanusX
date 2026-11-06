import { z } from 'zod'
import type {
  SuperAgentDelivery, SuperAgentExecution, SuperAgentInput, SuperAgentReport,
  SuperAgentResource, SuperAgentWork,
} from '../../../shared/superagent'

export const identity = z.string().min(1).max(256).refine(value => value.trim() === value && !/[\x00-\x1f]/.test(value))
export const text = z.string().refine(value => value.trim().length > 0, 'Text must not be empty')
const timestamp = z.number().int().nonnegative().safe()
const uuid = z.string().uuid()
export const workspaceSchema = z.object({ workspaceId: identity, workspacePath: text }).strict()
export const submitInputSchema = z.object({ eventId: identity, workspaceId: identity, conversationId: identity, text }).strict()

const resourceSchema: z.ZodType<SuperAgentResource> = z.object({
  id: uuid, workspaceId: identity, kind: z.enum(['input', 'report']), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative().safe(), createdAt: timestamp,
}).strict()
const inputSchema: z.ZodType<SuperAgentInput> = workspaceSchema.extend({
  id: uuid, eventId: identity, conversationId: identity, sequence: z.number().int().positive().safe(),
  resourceId: uuid, receivedAt: timestamp, status: z.enum(['received', 'routed', 'handled']),
}).strict()
const workSchema: z.ZodType<SuperAgentWork> = workspaceSchema.extend({
  id: uuid, creationId: identity, title: text, goal: text, sourceInputId: uuid,
  revision: z.number().int().positive().safe(), createdAt: timestamp, updatedAt: timestamp,
  closedAt: timestamp.nullable(), latestExecutionId: uuid.nullable(), latestReportId: identity.nullable(),
}).strict()
const deliverySchema: z.ZodType<SuperAgentDelivery> = z.object({
  id: uuid, workspaceId: identity, inputId: uuid, workId: uuid, executionId: uuid.nullable(),
  status: z.enum(['pending', 'delivered', 'incorporated', 'unknown', 'cancelled']), updatedAt: timestamp,
}).strict()
const executionSchema: z.ZodType<SuperAgentExecution> = z.object({
  id: uuid, workspaceId: identity, workId: uuid, instanceId: identity, cwd: text,
  providerSessionId: identity.nullable(), nativeTurnId: identity.nullable(), recordedAt: timestamp,
}).strict()
const reportSchema: z.ZodType<SuperAgentReport> = z.object({
  id: identity, workspaceId: identity, workId: uuid, executionId: uuid,
  kind: z.enum(['ready', 'question', 'failure']), summary: text, resourceId: uuid, receivedAt: timestamp,
  availableInputIds: z.array(uuid).optional(),
}).strict()

export const documentSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative().safe(),
  works: z.array(workSchema), inputs: z.array(inputSchema), deliveries: z.array(deliverySchema),
  executions: z.array(executionSchema), reports: z.array(reportSchema), resources: z.array(resourceSchema),
}).strict()
export type SuperAgentDocument = z.infer<typeof documentSchema>

export function emptyDocument(): SuperAgentDocument {
  return { version: 1, revision: 0, works: [], inputs: [], deliveries: [], executions: [], reports: [], resources: [] }
}

/** Reject damaged relationships instead of dropping rows and overwriting the original file. */
export function parseDocument(value: unknown): SuperAgentDocument {
  const data = documentSchema.parse(value)
  const unique = <T>(rows: T[], key: (row: T) => string | number): void => {
    if (new Set(rows.map(key)).size !== rows.length) throw new Error('Duplicate record identity')
  }
  for (const rows of [data.works, data.inputs, data.deliveries, data.executions, data.reports, data.resources]) unique<{ id: string }>(rows, row => row.id)
  unique(data.inputs, row => row.eventId)
  unique(data.inputs, row => row.sequence)
  unique(data.works, row => row.creationId)
  unique(data.deliveries, row => `${row.workId}:${row.inputId}`)
  const index = <T extends { id: string }>(rows: T[]) => new Map(rows.map(row => [row.id, row]))
  const works = index(data.works), inputs = index(data.inputs), executions = index(data.executions)
  const reports = index(data.reports), resources = index(data.resources)
  const sameScope = (row: { workspaceId: string }, target?: { workspaceId: string }): void => {
    if (!target || target.workspaceId !== row.workspaceId) throw new Error('Invalid record relationship')
  }
  const body = (row: { workspaceId: string; resourceId: string }, kind: SuperAgentResource['kind']) => {
    const resource = resources.get(row.resourceId)
    sameScope(row, resource)
    if (resource?.kind !== kind) throw new Error('Invalid resource kind')
  }
  for (const row of data.inputs) body(row, 'input')
  for (const row of data.works) {
    sameScope(row, inputs.get(row.sourceInputId))
    for (const target of [row.latestExecutionId ? executions.get(row.latestExecutionId) : null, row.latestReportId ? reports.get(row.latestReportId) : null]) {
      if (target === null) continue
      sameScope(row, target)
      if (target?.workId !== row.id) throw new Error('Invalid work reference')
    }
  }
  for (const row of data.executions) sameScope(row, works.get(row.workId))
  for (const row of data.deliveries) {
    sameScope(row, works.get(row.workId)); sameScope(row, inputs.get(row.inputId))
    if (row.executionId) {
      const execution = executions.get(row.executionId)
      sameScope(row, execution)
      if (execution?.workId !== row.workId) throw new Error('Invalid delivery execution')
    } else if (row.status !== 'pending' && row.status !== 'cancelled') throw new Error('Delivery evidence requires an execution')
  }
  for (const row of data.reports) {
    body(row, 'report'); sameScope(row, works.get(row.workId))
    const execution = executions.get(row.executionId)
    sameScope(row, execution)
    if (execution?.workId !== row.workId) throw new Error('Invalid report execution')
    for (const inputId of row.availableInputIds ?? []) {
      sameScope(row, inputs.get(inputId))
      if (!data.deliveries.some(delivery => delivery.workId === row.workId && delivery.inputId === inputId)) throw new Error('Invalid report input coverage')
    }
  }
  return data
}

export const createWorkSchema = z.object({ creationId: identity, sourceInputId: uuid, title: text, goal: text }).strict()
export const recordExecutionSchema = z.object({
  executionId: uuid, workId: uuid, expectedRevision: z.number().int().positive().safe(), instanceId: identity, cwd: text,
  providerSessionId: identity.nullable().default(null), nativeTurnId: identity.nullable().default(null),
}).strict()
export const recordReportSchema = z.object({
  reportId: identity, executionId: uuid, kind: z.enum(['ready', 'question', 'failure']), summary: text, text,
}).strict()
export const deliveryUpdateSchema = z.object({
  deliveryId: uuid, executionId: uuid.nullable(), status: z.enum(['delivered', 'incorporated', 'unknown', 'cancelled']),
}).strict()
