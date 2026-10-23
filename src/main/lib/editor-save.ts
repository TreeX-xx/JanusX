// Note: .agents/notes/workbench/plugin-contract-v1.md — host-reviewed drafts and version checks.
import { createHash } from 'node:crypto'
import { basename, dirname } from 'node:path'
import type { FileSaveResult } from '../../shared/ipc/workspace'
import { readPluginFile } from '../plugins/files'
import { SerialQueue } from './atomic-file'

// Serialize all editor saves, including legacy saves, so two host requests cannot
// both commit against one baseline. External processes do not share this queue.
const saves = new SerialQueue()
export function saveEditorText(path: string, content: string, expectedVersion: string | undefined,
  write: () => Promise<void>): Promise<FileSaveResult> {
  return saves.run(async () => {
    if (expectedVersion !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(expectedVersion)) throw new Error('Invalid document version')
      try {
        const current = await readPluginFile(dirname(path), basename(path), 1024 * 1024)
        if (createHash('sha256').update(current).digest('hex') !== expectedVersion) return { conflict: true, error: 'DOCUMENT_CONFLICT' }
      } catch { return { conflict: true, error: 'DOCUMENT_CONFLICT' } }
    }
    await write()
    return { success: true, ...(expectedVersion === undefined ? {} : { version: createHash('sha256').update(content).digest('hex') }) }
  })
}
