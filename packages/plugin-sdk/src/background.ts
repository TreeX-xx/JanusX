// Note: .agents/notes/workbench/plugin-contract-v1.md — P5 declarative execution contract.
import { z } from 'zod'

export const backgroundId = z.string().min(1).max(128).regex(/^[a-z][a-z0-9.-]*$/)
  .refine(value => !value.includes('..') && !value.endsWith('.') && !['constructor', 'prototype', '__proto__'].includes(value))
export const networkOriginSchema = z.string().max(256).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.port
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) && !/^[\d.]+$/.test(url.hostname) } catch { return false }
})
export const networkRequestSchema = z.object({
  url: z.string().min(1).max(2048), method: z.enum(['GET', 'POST']).optional(),
  body: z.string().max(32 * 1024).refine(value => new TextEncoder().encode(value).byteLength <= 32 * 1024).optional(), credential: backgroundId.optional(),
}).strict()
export type PluginNetworkRequest = z.infer<typeof networkRequestSchema>
export interface PluginNetworkResult { status: number; body: string; contentType: string }
export const messageShapeSchema = z.record(z.enum(['string', 'number', 'boolean']))
  .refine(value => Object.keys(value).length <= 32 && Object.keys(value).every(key => backgroundId.safeParse(key).success))
export type PluginMessageShape = z.infer<typeof messageShapeSchema>
export type PluginMessage = Record<string, string | number | boolean>
export const messageSchema = z.record(z.union([z.string().max(4096), z.number().finite(), z.boolean()]))
  .refine(value => Object.keys(value).length <= 32 && Object.keys(value).every(key => backgroundId.safeParse(key).success))
export function matchesPluginMessage(shape: PluginMessageShape, data: PluginMessage): boolean {
  return messageSchema.safeParse(data).success && Object.keys(data).length === Object.keys(shape).length
    && Object.entries(shape).every(([key, type]) => Object.hasOwn(data, key) && typeof data[key] === type)
}
export const serviceCallSchema = z.object({ plugin: backgroundId, service: backgroundId,
  version: z.number().int().min(1).max(1000), input: messageSchema }).strict()
export const eventPublishSchema = z.object({ event: backgroundId, data: messageSchema, cause: z.string().uuid().optional() }).strict()
export const pluginTaskSchema = z.object({ id: backgroundId, title: z.string().min(1).max(80),
  scope: z.enum(['application', 'project']), input: messageShapeSchema,
  timeoutMs: z.number().int().min(10).max(60_000),
  steps: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('delay'), milliseconds: z.number().int().min(0).max(60_000) }).strict(),
    z.object({ type: z.literal('log'), message: z.string().max(240).refine(value => !/[\x00-\x1f\x7f]/.test(value)) }).strict(),
    z.object({ type: z.literal('request'), request: networkRequestSchema, bodyFromInput: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('emit'), event: backgroundId, data: messageSchema, fromInput: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('service'), ...serviceCallSchema.shape }).strict(),
  ])).min(1).max(32),
}).strict()
const clients = z.array(backgroundId).max(32).refine(values => new Set(values).size === values.length)
export const pluginPublicEventSchema = z.object({ id: backgroundId, version: z.number().int().min(1).max(1000),
  scope: z.enum(['application', 'project']), data: messageShapeSchema, consumers: clients }).strict()
export const pluginPublicServiceSchema = z.object({ id: backgroundId, version: z.number().int().min(1).max(1000),
  task: backgroundId, consumers: clients }).strict()
export const pluginConsumptionSchema = z.object({ plugin: backgroundId, id: backgroundId,
  version: z.number().int().min(1).max(1000), schema: messageShapeSchema, optional: z.boolean().optional() }).strict()
export const pluginCredentialSchema = z.object({ id: backgroundId, title: z.string().min(1).max(80), origin: networkOriginSchema }).strict()
export interface PluginTaskRun {
  id: string; pluginId: string; task: string; projectId: string | null; rootId: string | null
  state: 'running' | 'completed' | 'cancelled' | 'timeout' | 'failed'; started: string; finished?: string
  logs: Array<{ time: string; code: string; message?: string }>; results: PluginNetworkResult[]; error?: string
}
/** Host Agent adapter uses the same versioned service and primitive task input as plugin UI clients. */
export interface PluginAgentService {
  plugin: string; service: string; version: number; title: string
  scope: 'application' | 'project'; input: PluginMessageShape
}
export interface PluginPublicEvent { id: string; source: string; event: string; version: number; data: PluginMessage; trace: string[] }
