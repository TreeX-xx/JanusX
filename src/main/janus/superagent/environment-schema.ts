import { z } from 'zod'
import { identity, text } from './schema'
import type { SuperAgentCheckout, SuperAgentEnvironment, SuperAgentGitOperation, SuperAgentGitPlan } from '../../../shared/superagent-environment'
import { overlaps } from '../../git/controlled-worktree'

const timestamp = z.number().int().nonnegative().safe()
const hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i)
const uuid = z.string().uuid()
export const checkoutSchema: z.ZodType<SuperAgentCheckout> = z.object({
  path: text, commonDir: text, gitDir: text, repositoryIdentity: hash, directoryIdentity: hash,
  branch: text, head: hash, dirty: z.boolean(), ignoredEntries: z.array(text), locked: z.boolean(), isMain: z.boolean(), operationInProgress: z.boolean(),
}).strict()
const planSchema: z.ZodType<SuperAgentGitPlan> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), source: checkoutSchema, targetPath: text, branch: text, baseRef: text, baseCommit: hash, setup: z.literal('isolated') }).strict(),
  z.object({ kind: z.literal('merge'), source: checkoutSchema, target: checkoutSchema, environmentId: uuid, strategy: z.literal('no-ff') }).strict(),
  z.object({ kind: z.literal('remove'), source: checkoutSchema, target: checkoutSchema, environmentId: uuid,
    unmergedCommits: z.number().int().nonnegative(), preserveBranch: z.literal(true), force: z.literal(false) }).strict(),
])
const environmentSchema: z.ZodType<SuperAgentEnvironment> = z.object({
  id: uuid, workspaceId: identity, workId: uuid, workspacePath: text, checkout: checkoutSchema,
  baseRef: text, baseCommit: hash, createdAt: timestamp, removedAt: timestamp.nullable(),
}).strict()
const operationSchema: z.ZodType<SuperAgentGitOperation> = z.object({
  id: uuid, workspaceId: identity, workId: uuid, workRevision: z.number().int().positive().safe(), plan: planSchema,
  createdAt: timestamp, expiresAt: timestamp,
  status: z.enum(['pending', 'rejected', 'stale', 'executing', 'succeeded', 'failed', 'unknown']),
  decidedAt: timestamp.nullable(), finishedAt: timestamp.nullable(), message: z.string().nullable(),
}).strict()
export const environmentDocumentSchema = z.object({
  version: z.literal(1), revision: timestamp, environments: z.array(environmentSchema), operations: z.array(operationSchema),
}).strict()
export type EnvironmentDocument = z.infer<typeof environmentDocumentSchema>

export const environmentDecisionSchema = z.object({ workspaceId: identity, operationId: uuid, approved: z.boolean() }).strict()
export const createEnvironmentSchema = z.object({ workId: uuid, branch: text.optional(), baseRef: text.optional() }).strict()
export const reuseEnvironmentSchema = z.object({ workId: uuid, path: text, branch: text }).strict()

export function parseEnvironmentDocument(value: unknown): EnvironmentDocument {
  const data = environmentDocumentSchema.parse(value)
  for (const rows of [data.environments, data.operations]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate environment record identity')
  }
  const active = data.environments.filter(row => row.removedAt === null)
  if (new Set(active.map(row => row.workId)).size !== active.length) throw new Error('Work has multiple active environments')
  for (let i = 0; i < active.length; i++) {
    if (active.slice(i + 1).some(other => overlaps(active[i].checkout.path, other.checkout.path))) throw new Error('Active work environments overlap')
  }
  for (const operation of data.operations) {
    const plan = operation.plan
    if (plan.kind === 'create') continue
    const target = data.environments.find(row => row.id === plan.environmentId)
    if (!target || target.workId !== operation.workId || target.workspaceId !== operation.workspaceId) throw new Error('Invalid operation environment relationship')
  }
  return data
}
