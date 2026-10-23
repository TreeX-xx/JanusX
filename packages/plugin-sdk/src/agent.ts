// Note: .agents/notes/workbench/plugin-contract-v1.md — P6 inert plugin skill resources.
import { z } from 'zod'
import { backgroundId, type PluginAgentService } from './background.js'

export const pluginSkillSchema = z.object({
  id: backgroundId, version: z.number().int().min(1).max(1000),
  title: z.string().min(1).max(80).refine(value => Boolean(value.trim())),
  description: z.string().min(1).max(240).refine(value => Boolean(value.trim())),
  scope: z.enum(['application', 'project']),
  instructions: z.string().min(1).max(8000).refine(value => Boolean(value.trim())
    && new TextEncoder().encode(value).byteLength <= 16 * 1024 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)),
  services: z.array(z.object({ service: backgroundId, version: z.number().int().min(1).max(1000) }).strict())
    .max(8).refine(items => new Set(items.map(item => item.service)).size === items.length),
}).strict()
export const pluginSkillReadSchema = z.object({ plugin: backgroundId, skill: backgroundId,
  version: z.number().int().min(1).max(1000), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export interface PluginAgentSkill {
  plugin: string; skill: string; version: number; revision: string
  title: string; description: string; scope: 'application' | 'project'
}
export interface PluginAgentSkillCatalog { skills: PluginAgentSkill[]; truncated: boolean }
export interface PluginAgentSkillResource extends PluginAgentSkill {
  trust: 'untrusted-plugin-content'; instructions: string; services: PluginAgentService[]
}
