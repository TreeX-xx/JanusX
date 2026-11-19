import { homedir } from 'node:os'
import { providerPathContext, resolveProviderPaths } from '../external-cli/provider-paths'

/** Shared by session discovery, transcript recovery and usage accounting. */
export function resolveOpencodeDbPath(home: string = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  const store = resolveProviderPaths('opencode', providerPathContext({ env, home })).store
  if (!store) throw new Error('OpenCode has no persistent session store in the active configuration')
  return store
}
