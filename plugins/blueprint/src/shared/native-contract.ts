import { z } from 'zod'
import type { NativeAgentProgress } from '@janusx/plugin-sdk'

export const BLUEPRINT_PLUGIN_ID = 'official.blueprint'
export const BLUEPRINT_NATIVE_METHODS = [
  'workspace.activate', 'workspace.release', 'blueprint.graph', 'blueprint.layout', 'notes.snapshot', 'notes.read', 'notes.rescan',
  'workspace.status', 'workspace.init-preview', 'workspace.init-apply', 'workspace.init-undo',
  'review.activity', 'review.read', 'review.saved', 'review.run', 'review.cancel', 'review.close',
  'reading.mark', 'reading.undo', 'repair.prepare', 'repair.run', 'repair.diff', 'repair.retry', 'repair.undo',
  'settings.read', 'settings.snapshot', 'settings.update', 'settings.check', 'models.catalog', 'jobs.read', 'jobs.cancel',
  'mcp.status', 'mcp.change', 'mcp.probe', 'mcp.guide',
  'discussion.read', 'discussion.clear', 'discussion.run',
  'maintenance.list', 'maintenance.start', 'maintenance.propose', 'maintenance.dispatch', 'maintenance.preview', 'maintenance.apply',
  'maintenance.cancel', 'maintenance.complete', 'maintenance.dismiss',
] as const
export const nativeProjectSchema = z.object({ id: z.string().min(1).max(256), root: z.string().min(1).max(4096), name: z.string().max(4096) }).strict()
export const blueprintServiceContextSchema = z.object({
  apiVersion: z.literal(1), pluginId: z.literal(BLUEPRINT_PLUGIN_ID), dataVersion: z.literal(1),
  directory: z.string().min(1), applicationDataDirectory: z.string().min(1), allowLegacyImport: z.boolean().optional(), projects: z.array(nativeProjectSchema).max(256),
}).strict()
export type BlueprintJob = { id: string; root: string; method: string; status: 'running' | 'completed' | 'cancelled' | 'failed'; result?: unknown; error?: string;
  progress?: NativeAgentProgress }
