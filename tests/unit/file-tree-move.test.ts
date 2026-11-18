import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FILE_TREE_CHANNELS, type OperationResult } from '../../src/shared/ipc/workspace'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>()
  return { handlers }
})

vi.mock('fs', async importOriginal => ({ ...(await importOriginal<typeof import('fs')>()), watch: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}))

import { registerWorkspaceHandlers } from '../../src/main/ipc/handlers'

let workspaceRoot: string

function moveFile(source: string, targetDirectory: string): Promise<OperationResult> {
  const handler = mocks.handlers.get(FILE_TREE_CHANNELS.move)!
  return handler({ sender: { id: 1 } }, workspaceRoot, source, targetDirectory)
}

describe('file-tree move', () => {
  beforeEach(async () => {
    mocks.handlers.clear()
    workspaceRoot = await mkdtemp(join(tmpdir(), 'janusx-file-tree-move-'))
    await Promise.all([
      mkdir(join(workspaceRoot, 'source')),
      mkdir(join(workspaceRoot, 'target')),
    ])
    registerWorkspaceHandlers(() => null, {
      authorizeRendererAction: async () => true,
    })
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('moves a file into a workspace directory without changing its name', async () => {
    await writeFile(join(workspaceRoot, 'source', 'demo.txt'), 'demo')

    await expect(moveFile('source/demo.txt', 'target')).resolves.toEqual({
      success: true,
      error: undefined,
      path: 'target/demo.txt',
    })
    await expect(readFile(join(workspaceRoot, 'target', 'demo.txt'), 'utf8')).resolves.toBe('demo')
    await expect(stat(join(workspaceRoot, 'source', 'demo.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects duplicate destinations and directory sources', async () => {
    await Promise.all([
      writeFile(join(workspaceRoot, 'source', 'demo.txt'), 'source'),
      writeFile(join(workspaceRoot, 'target', 'demo.txt'), 'target'),
    ])

    await expect(moveFile('source/demo.txt', 'target')).resolves.toMatchObject({ success: false })
    await expect(moveFile('source', 'target')).resolves.toMatchObject({
      success: false,
      error: 'Only files can be moved',
    })
    await expect(moveFile('source', '')).resolves.toMatchObject({
      success: false,
      error: 'Only files can be moved',
    })
    await expect(readFile(join(workspaceRoot, 'source', 'demo.txt'), 'utf8')).resolves.toBe('source')
    await expect(readFile(join(workspaceRoot, 'target', 'demo.txt'), 'utf8')).resolves.toBe('target')
  })

  it('rejects a target outside the workspace', async () => {
    await writeFile(join(workspaceRoot, 'source', 'demo.txt'), 'demo')
    await expect(moveFile('source/demo.txt', '../outside')).resolves.toMatchObject({ success: false })
  })
})
