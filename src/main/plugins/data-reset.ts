import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../lib/atomic-file'

/** A deliberate private-data reset must also prevent importing pre-plugin data again after reinstall. */
export async function allowLegacyImport(directory: string, pluginId: string): Promise<boolean> {
  try { await access(join(directory, 'data-reset', pluginId + '.json')); return false }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return true; throw cause }
}
export async function markPluginDataReset(directory: string, pluginId: string): Promise<void> {
  await writeFileAtomic(join(directory, 'data-reset', pluginId + '.json'), JSON.stringify({ version: 1 }) + '\n')
}
