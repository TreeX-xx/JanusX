import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { directoryEntries } from '../../src/main/platform/directory-entries'

it.skipIf(process.platform !== 'win32')('returns Windows directory entries and filesystem errors without calling native opendir', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'janusx-directory-'))
  const opendir = vi.fn<typeof fs.opendir>()
  const files = { readdir: fs.readdir, opendir }
  try {
    const file = join(root, 'entry')
    await fs.writeFile(file, '')
    const names = []
    for await (const entry of await directoryEntries(root, files)) {
      names.push([entry.name, entry.isFile()])
    }
    expect(names).toEqual([['entry', true]])
    await expect(directoryEntries(file, files)).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(directoryEntries(join(root, 'missing'), files)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(opendir).not.toHaveBeenCalled()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
