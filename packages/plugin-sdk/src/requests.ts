import { z } from 'zod'
import type { PluginManifest } from './manifest.js'
import { PluginError } from './errors.js'
import { isSensitivePluginPath, validatePluginPath } from './paths.js'
import { pluginIslandStatusSchema } from './island.js'

const empty = z.object({}).strict()
const key = z.string().min(1).max(128).refine((value) => !value.includes('\0') && !['__proto__', 'prototype', 'constructor'].includes(value))
const revision = z.number().int().nonnegative().optional()
function isJson(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1))
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value).every((item) => isJson(item, depth + 1))
}
const json = z.unknown().refine((value) => isJson(value)).refine((value) => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 64 * 1024 } catch { return false }
})
const methods = {
  'app.getInfo': { permission: null, params: empty },
  'workspace.getContext': { permission: 'workspace.context.read', params: empty },
  'workspace.readText': { permission: 'workspace.files.read', params: z.object({ path: z.string() }).strict() },
  'documents.readText': { permission: 'documents.read', params: empty },
  'documents.applyEdit': { permission: 'documents.edit', params: z.object({
    text: z.string().max(1024 * 1024).refine(value => !value.includes('\0') && new TextEncoder().encode(value).byteLength <= 1024 * 1024),
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict() },
  'views.open': { permission: 'ui.views.open', params: z.object({ view: z.string() }).strict() },
  'island.update': { permission: 'ui.island', params: z.object({ id: z.string(), status: pluginIslandStatusSchema.nullable() }).strict() },
  'ui.showToast': { permission: 'ui.toast', params: z.object({ message: z.string().max(500), level: z.enum(['info', 'warning', 'error']).optional() }).strict() },
  'storage.get': { permission: 'plugin.storage', params: z.object({ key }).strict() },
  'storage.set': { permission: 'plugin.storage', params: z.object({ key, value: json, expectedRevision: revision }).strict() },
  'storage.delete': { permission: 'plugin.storage', params: z.object({ key, expectedRevision: revision }).strict() },
  'storage.watch': { permission: 'plugin.storage', params: z.object({ keys: z.array(key).min(1).max(32) }).strict() },
  'context.subscribe': { permission: null, params: empty },
} as const

/** Pure policy gate; sender, grants, context and filesystem checks remain mandatory in P2. */
export function validatePluginCall(manifest: PluginManifest, method: string, params: unknown): void {
  if (!Object.hasOwn(methods, method)) throw new PluginError('UNKNOWN_METHOD', 'Plugin method is unavailable.')
  const definition = methods[method as keyof typeof methods]
  if (definition.permission && !manifest.permissions.some((permission) => permission.name === definition.permission)) {
    throw new PluginError('PERMISSION_DENIED', 'The method is outside the declared permissions.')
  }
  if (!definition.params.safeParse(params).success) throw new PluginError('INVALID_REQUEST', 'Invalid method parameters.')
  if (method === 'workspace.readText') {
    const path = validatePluginPath((params as { path: string }).path)
    if (isSensitivePluginPath(path)) throw new PluginError('SENSITIVE_PATH_DENIED', 'Sensitive files are unavailable.')
    if (!manifest.permissions.some((permission) => permission.name === 'workspace.files.read' && permission.paths.includes(path))) {
      throw new PluginError('PATH_NOT_GRANTED', 'The path is outside the declared files.')
    }
  }
  if (method === 'views.open' && !manifest.contributes.views.some((view) => view.id === (params as { view: string }).view)) {
    throw new PluginError('INVALID_REQUEST', 'Only a declared view can be opened.')
  }
  if (method === 'island.update' && !manifest.contributes.island?.some(item => item.id === (params as { id: string }).id)) {
    throw new PluginError('INVALID_REQUEST', 'Only a declared Island contribution can be updated.')
  }
}
