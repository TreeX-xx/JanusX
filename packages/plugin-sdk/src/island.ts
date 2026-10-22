import { z } from 'zod'

// Note: .agents/notes/workbench/plugin-contract-v1.md — P3 host-rendered Island data.
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))
export const pluginIslandStatusSchema = z.object({
  title: text(80),
  description: text(240).optional(),
  state: z.enum(['idle', 'running', 'success', 'warning', 'error']),
  progress: z.number().finite().min(0).max(100).optional(),
  badge: text(12).optional(),
  preview: z.object({
    text: text(500),
    rows: z.array(z.object({ label: text(40), value: text(120) }).strict()).max(4).optional(),
  }).strict().optional(),
}).strict()

export type PluginIslandStatus = z.infer<typeof pluginIslandStatusSchema>
