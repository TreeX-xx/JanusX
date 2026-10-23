// Note: .agents/notes/workbench/plugin-contract-v1.md — declarative user configuration.
import { z } from 'zod'

export type PluginSettingValue = string | number | boolean
const common = {
  key: z.string().min(1).max(64).regex(/^[a-z][a-z0-9.-]*$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value)),
  title: z.string().trim().min(1).max(80), description: z.string().max(500).optional(),
  /** project permits a project/root override of the application value. */
  scope: z.enum(['application', 'project']),
}
export const pluginSettingSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('boolean'), default: z.boolean() }).strict(),
  z.object({ ...common, type: z.literal('string'), default: z.string().max(4096),
    minLength: z.number().int().min(0).max(4096).optional(), maxLength: z.number().int().min(0).max(4096).optional() }).strict(),
  z.object({ ...common, type: z.literal('number'), default: z.number().finite(),
    minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), integer: z.boolean().optional() }).strict(),
  z.object({ ...common, type: z.literal('enum'), default: z.string().max(256),
    options: z.array(z.string().min(1).max(256)).min(1).max(32).refine(values => new Set(values).size === values.length) }).strict(),
])
export type PluginSetting = z.infer<typeof pluginSettingSchema>
export const pluginSettingMigrationSchema = z.object({ from: common.key, to: common.key }).strict()
export function isPluginSettingValue(setting: PluginSetting, value: unknown): value is PluginSettingValue {
  if (setting.type === 'boolean') return typeof value === 'boolean'
  if (setting.type === 'string') return typeof value === 'string' && !value.includes('\0')
    && value.length >= (setting.minLength ?? 0) && value.length <= (setting.maxLength ?? 4096)
  if (setting.type === 'enum') return typeof value === 'string' && setting.options.includes(value)
  return typeof value === 'number' && Number.isFinite(value) && (!setting.integer || Number.isInteger(value))
    && value >= (setting.minimum ?? -Infinity) && value <= (setting.maximum ?? Infinity)
}
export interface PluginConfiguration {
  values: Record<string, PluginSettingValue>
  /** Explicit values for this scope; absent project keys inherit application values. */
  overrides: Record<string, PluginSettingValue>
  /** Defaults for application settings, effective application values for project settings. */
  inherited: Record<string, PluginSettingValue>
  revision: string
  /** Key names only: incompatible persisted values are ignored, never silently erased. */
  issues: string[]
}
