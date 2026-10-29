import type { InstalledPlugin } from './ipc/plugins'

/** Legacy snapshots retain their explicit list; current installed records use all workspaces. */
export function hasPluginProjectAccess(plugin: Pick<InstalledPlugin, 'projectScope' | 'projects'> | undefined, projectId: string): boolean {
  return Boolean(plugin && (plugin.projectScope === 'all' || plugin.projects.includes(projectId)))
}
