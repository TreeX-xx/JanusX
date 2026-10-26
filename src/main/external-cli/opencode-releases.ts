import { openCodeChannel, type OpenCodeChannel } from '../../shared/ipc/external-cli'
import { fetchLatestVersion } from './latest'
import { OPENCODE_PACKAGES } from './tool-registry'

export async function fetchOpenCodeVersions(
  latest: typeof fetchLatestVersion = fetchLatestVersion,
): Promise<Partial<Record<OpenCodeChannel, string>>> {
  const versions: Partial<Record<OpenCodeChannel, string>> = {}
  await Promise.all((['v1', 'v2'] as const).map(async channel => {
    const version = await latest(OPENCODE_PACKAGES[channel]).catch(() => undefined)
    // Refuse snapshots, prereleases and future package repurposing as stable upgrades.
    if (version && /^\d+\.\d+\.\d+$/.test(version) && openCodeChannel(version) === channel) {
      versions[channel] = version
    }
  }))
  return versions
}
