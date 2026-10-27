// Note: .agents/notes/workbench/plugin-contract-v1.md — host-owned configuration navigation.
import type { PluginSettingValue } from '@janusx/plugin-sdk'
export interface PluginConfigurationTarget {
  pluginId: string; scope: 'application' | 'project'
  proposal?: { expectedRevision: string; patch: Record<string, PluginSettingValue | null> }
}
export const PLUGIN_CONFIGURATION_EVENT = 'janusx:open-plugin-configuration'
export const PLUGIN_SETTINGS_EVENT = 'janusx:open-plugin-settings'
export const PLUGIN_MANAGEMENT_EVENT = 'janusx:open-plugin-manager'
export interface PluginAuthorizationTarget { pluginId: string; projectId: string }
export function openPluginManager(): void {
  window.dispatchEvent(new CustomEvent(PLUGIN_MANAGEMENT_EVENT))
}
export function reviewPluginAuthorization(target: PluginAuthorizationTarget): void {
  window.dispatchEvent(new CustomEvent(PLUGIN_MANAGEMENT_EVENT, { detail: target }))
}
/** Trusted renderer only. Isolated pages must use the identity-bound broker. */
export function openPluginConfiguration(target: PluginConfigurationTarget): void {
  window.dispatchEvent(new CustomEvent(PLUGIN_CONFIGURATION_EVENT, { detail: target }))
}
