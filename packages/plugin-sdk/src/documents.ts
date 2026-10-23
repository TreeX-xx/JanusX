// Note: .agents/notes/workbench/plugin-contract-v1.md — read-only viewer selectors and document identity.
import { z } from 'zod'
import { isSensitivePluginPath, validatePluginPath } from './paths.js'

/** Explicit file selectors; no recursive glob or directory access is implied. */
export const pluginViewerSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9.-]*$/),
  title: z.string().trim().min(1).max(80),
  view: z.string().min(1).max(64),
  extensions: z.array(z.string().max(32).regex(/^\.[a-z0-9][a-z0-9.-]*$/)).max(32).default([]),
  filenames: z.array(z.string().min(1).max(128).regex(/^[^/\\:*?<>|\x00-\x1f]+$/)).max(32).default([]),
}).strict().refine(viewer => viewer.extensions.length + viewer.filenames.length > 0, 'A file selector is required')

export type PluginViewer = z.infer<typeof pluginViewerSchema>
export interface PluginDocument { viewer: string; path: string }

export function matchesPluginViewer(viewer: PluginViewer, path: string): boolean {
  try { validatePluginPath(path) } catch { return false }
  if (isSensitivePluginPath(path)) return false
  const name = path.split('/').pop()!.toLowerCase()
  return viewer.filenames.some(item => item.toLowerCase() === name)
    || viewer.extensions.some(extension => name.endsWith(extension))
}
