import { z } from 'zod'
import { nativeValueSchema } from './native-protocol.js'

/** Only read tools are accepted by this API. Mutations use a separate, user-confirmed transaction. */
const toolInputSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.record(nativeValueSchema)).optional(),
  required: z.array(z.string().min(1).max(128)).max(128).optional(),
  additionalProperties: z.boolean().optional(),
}).strict()
export const nativeAgentRequestSchema = z.object({
  runId: z.string().uuid(), projectId: z.string().min(1).max(256), root: z.string().min(1).max(4096),
  providerId: z.string().min(1).max(256), modelId: z.string().min(1).max(256),
  progress: z.boolean().optional(),
  system: z.string().max(64_000), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(300_000) }).strict()).min(1).max(64),
  tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,127}$/), description: z.string().max(4096),
    actionRisk: z.literal('read'), inputSchema: toolInputSchema }).strict()).min(1).max(32),
}).strict().superRefine((value, context) => {
  if (new Set(value.tools.map(tool => tool.name)).size !== value.tools.length) context.addIssue({ code: 'custom', message: 'Duplicate tool name' })
})
export type NativeAgentRequest = z.infer<typeof nativeAgentRequestSchema>

/** Coalesced snapshots, scoped to one run. No reasoning, tool arguments or tool results cross this channel. */
export const nativeAgentProgressSchema = z.object({
  runId: z.string().uuid(), sequence: z.number().int().positive(),
  text: z.string().max(300_000), phase: z.enum(['thinking', 'tool', 'answer']),
  tool: z.string().max(128).optional(),
}).strict()
export type NativeAgentProgress = z.infer<typeof nativeAgentProgressSchema>
