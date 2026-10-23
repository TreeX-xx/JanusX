// Note: .agents/notes/workbench/plugin-contract-v1.md — bounded declarative document context.
import { z } from 'zod'
import { backgroundId } from './background.js'
import { isSensitivePluginPath, validatePluginPath } from './paths.js'

export const pluginContextProviderSchema = z.object({
  id: backgroundId, version: z.number().int().min(1).max(1000),
  title: z.string().min(1).max(80).refine(value => Boolean(value.trim())),
  description: z.string().min(1).max(240).refine(value => Boolean(value.trim())),
  path: z.string().superRefine((value, ctx) => {
    try { validatePluginPath(value); if (isSensitivePluginPath(value)) throw new Error() }
    catch { ctx.addIssue({ code: 'custom', message: 'Context requires a non-sensitive relative file path' }) }
  }),
}).strict()
export const pluginContextReadSchema = z.object({ plugin: backgroundId, provider: backgroundId,
  version: z.number().int().min(1).max(1000), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export type PluginContextRead = z.infer<typeof pluginContextReadSchema>
export interface PluginDocumentContext {
  plugin: string; provider: string; version: number; revision: string
  title: string; description: string; path: string; scope: 'project'
}
export interface PluginDocumentContextCatalog { providers: PluginDocumentContext[]; truncated: boolean }
export interface PluginDocumentContextResource extends PluginDocumentContext {
  trust: 'untrusted-plugin-content'; text: string; bytes: number; documentVersion: string
}
