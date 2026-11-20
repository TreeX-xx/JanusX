// Note: .agents/notes/terminal/requirements/usage-telemetry-single-source.md
import { targetPath } from '../platform/environment'
import { providerPathContext, resolveProviderPaths, type ProviderPathContext } from '../external-cli/provider-paths'
import { runtimePathKey } from '../../shared/runtime/path-identity'
import { HISTORY_ENGINES, normalizeHistorySourceSettings, type HistorySource, type HistorySourceSettings } from '../../shared/history-sources'

/** Native history readers share these locations. DSH currently uses them for usage only. */
export function resolveHistorySources(
  settings: HistorySourceSettings = { disabledAutomatic: [], locations: [] },
  context: ProviderPathContext = providerPathContext(),
  cwdRoots: string[] = [],
  retained: Partial<Record<string, string[]>> = {},
): HistorySource[] {
  const { basename, dirname, join } = targetPath(context.platform)
  const result = new Map<string, HistorySource>()
  const add = (source: HistorySource) => {
    const key = `${source.engine}:${runtimePathKey(source.path, context.platform === 'win32' ? 'windows' : 'posix')}`
    if (!result.has(key)) result.set(key, source)
  }
  const config = normalizeHistorySourceSettings(settings)
  for (const engine of HISTORY_ENGINES) {
    for (const cwd of [context.cwd, ...cwdRoots]) {
      const paths = resolveProviderPaths(engine, { ...context, cwd })
      if (paths.store) add({ engine, path: paths.store, namespace: engine === 'claude' || engine === 'codex' ? paths.configHome! : paths.store,
        automatic: true, enabled: !config.disabledAutomatic.includes(engine) })
      if (engine === 'codex' && paths.configHome) add({ engine, path: join(paths.configHome, 'archived_sessions'), namespace: paths.configHome,
        automatic: true, enabled: !config.disabledAutomatic.includes(engine) })
    }
    if (engine !== 'opencode') for (const path of retained[engine] ?? []) add({ engine, path,
      namespace: engine === 'claude' || engine === 'codex' ? dirname(path) : path, automatic: true, enabled: !config.disabledAutomatic.includes(engine) })
  }
  for (const location of config.locations) {
    const namespace = (location.engine === 'claude' && basename(location.path) === 'projects')
      || (location.engine === 'codex' && ['sessions', 'archived_sessions'].includes(basename(location.path))) ? dirname(location.path) : location.path
    // Explicit entries also allow disabling an individual automatic location.
    const key = `${location.engine}:${runtimePathKey(location.path, context.platform === 'win32' ? 'windows' : 'posix')}`
    result.set(key, { ...location, namespace, automatic: false })
  }
  return [...result.values()]
}
