// Note: .agents/notes/desktop/reproducible-verification.md
import * as fs from 'node:fs/promises'

/** Windows Electron 45 can terminate in the native async opendir callback. */
export function directoryEntries(path: string, files: Pick<typeof fs, 'readdir' | 'opendir'> = fs) {
  return process.platform === 'win32'
    ? files.readdir(path, { withFileTypes: true })
    : files.opendir(path)
}
