// Note: .agents/notes/workbench/plugin-contract-v1.md — host-owned configuration navigation.
export interface PluginConfigurationTarget { pluginId: string; scope: 'application' | 'project' }
export const PLUGIN_CONFIGURATION_EVENT = 'janusx:open-plugin-configuration'
/** Trusted renderer only. Isolated pages must use the identity-bound broker. */
export function openPluginConfiguration(target: PluginConfigurationTarget): void {
  window.dispatchEvent(new CustomEvent(PLUGIN_CONFIGURATION_EVENT, { detail: target }))
}
