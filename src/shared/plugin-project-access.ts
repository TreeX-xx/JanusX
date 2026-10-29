// Note: .agents/notes/workbench/plugin-contract-v1.md - all registered workspaces.
import type { InstalledPlugin } from './ipc/plugins'

/** Old snapshots retain their list until the host restores their all-workspace policy. */
export function hasPluginProjectAccess(plugin: Pick<InstalledPlugin, 'projectScope' | 'projects'> | undefined, projectId: string): boolean {
  return Boolean(plugin && (plugin.projectScope === 'all' || plugin.projects.includes(projectId)))
}
