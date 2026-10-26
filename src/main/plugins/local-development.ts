// Note: isolated manual plugin testing — .agents/notes/planning/blueprint-official-plugin.md
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PluginService } from './service'

export interface LocalPluginBuild {
  profile: string
  archive: string
  release: string
  id: string
  version: string
}

/** The dedicated development build supplies this descriptor; production defines null. */
export async function installLocalDevelopmentPlugin(service: PluginService, build: LocalPluginBuild,
  runtime: { packaged: boolean; profile: string }): Promise<void> {
  if (runtime.packaged || resolve(runtime.profile) !== resolve(build.profile)) {
    throw new Error('Local plugin testing requires its dedicated development profile.')
  }
  const previous = service.snapshot().plugins.find(record => record.manifest.id === build.id)
  if (previous?.manifest.version === build.version) return
  if (previous?.enabled) await service.disable(build.id)
  const archive = await readFile(build.archive)
  // Reuse the verified installer. The user grants permissions and enables the package in Settings.
  await service.installPackage(archive)
}
