import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRuntimeResource, runtimeResource } from '../../src/shared/workspace-runtime'
import { getAbsolutePath } from '../../src/renderer/src/features/workspace/file-tree'
import { resolveLocalAssetAbsolutePath } from '../../src/renderer/src/lib/local-asset-resolver'
import { getFileName } from '../../src/renderer/src/lib/file-classification'

const mock = vi.hoisted(() => ({ data: '', request: vi.fn(), resolve: vi.fn(), handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', () => ({ app: { getPath: () => mock.data }, ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mock.handlers.set(channel, handler) } }))
vi.mock('../../src/main/workspace/runtime', () => ({ runtimeRequest: mock.request, resolveRuntimeResource: mock.resolve }))
vi.mock('../../src/main/agent/runtime/shell-runtime', () => ({ authorizeRendererAction: vi.fn(async () => true) }))
import { remoteOfficeFile, syncRemoteOfficeFile, retainRemoteOfficePreview, releaseRemoteOfficePreviews } from '../../src/main/office/remote-office-cache'
import { workspaceFileIpc } from '../../src/main/workspace/runtime-ipc'
import { FILE_CHANNELS, FILE_TREE_CHANNELS } from '../../src/shared/ipc/workspace'

afterEach(async () => {
  releaseRemoteOfficePreviews(['test-lease'])
  if (mock.data) { await rm(mock.data, { recursive: true, force: true }); mock.data = '' }
  vi.clearAllMocks()
})

describe('remote resource paths and previews', () => {
  it('encodes raw file names once and keeps Linux case and workspace identity', () => {
    const root = runtimeResource('one', '/project 你好')
    const file = getAbsolutePath(root, 'Folder/100% #中文.txt')
    expect(parseRuntimeResource(file)).toEqual({ workspaceId: 'one', path: '/project 你好/Folder/100% #中文.txt' })
    expect(getFileName(file)).toBe('100% #中文.txt')
    expect(file).not.toBe(getAbsolutePath(runtimeResource('two', '/project 你好'), 'Folder/100% #中文.txt'))
    expect(() => parseRuntimeResource('janusx-workspace://one/%2e%2e/private')).toThrow()
  })

  it('resolves Markdown images on the target and rejects local or outside references', () => {
    const options = { workspacePath: runtimeResource('one', '/project'), documentDir: runtimeResource('one', '/project/docs') }
    expect(resolveLocalAssetAbsolutePath('../你好%20image.png', options)).toBe(runtimeResource('one', '/project/你好 image.png'))
    expect(resolveLocalAssetAbsolutePath('/assets/logo.png', options)).toBe(runtimeResource('one', '/project/assets/logo.png'))
    expect(resolveLocalAssetAbsolutePath('../../private.png', options)).toBeNull()
    expect(resolveLocalAssetAbsolutePath('file:///C:/private.png', options)).toBeNull()
    expect(resolveLocalAssetAbsolutePath('C:/private.png', options)).toBeNull()
  })

  it('does not send filetree change events for reads or rejected conflicting writes', async () => {
    const resource = { runtime: { kind: 'wsl', distro: 'test', root: '/project' }, root: '/project', path: '/project/file.txt', relative: 'file.txt', workspaceId: 'one' }
    mock.resolve.mockResolvedValue(resource)
    const frame = {}, send = vi.fn(), event = { senderFrame: frame, sender: { mainFrame: frame, send } }
    for (const channel of [FILE_TREE_CHANNELS.load, FILE_CHANNELS.read, FILE_CHANNELS.save]) workspaceFileIpc.handle(channel, vi.fn())
    mock.request.mockResolvedValue([])
    await mock.handlers.get(FILE_TREE_CHANNELS.load)!(event, runtimeResource('one', '/project'))
    await mock.handlers.get(FILE_CHANNELS.read)!(event, runtimeResource('one', '/project/file.txt'))
    expect(send).not.toHaveBeenCalled()
    mock.request.mockResolvedValue({ conflict: true })
    await mock.handlers.get(FILE_CHANNELS.save)!(event, runtimeResource('one', '/project/file.txt'), 'draft', 'old')
    expect(send).not.toHaveBeenCalled()
    mock.request.mockResolvedValue({ success: true })
    await mock.handlers.get(FILE_CHANNELS.save)!(event, runtimeResource('one', '/project/file.txt'), 'draft', 'new')
    expect(send).toHaveBeenCalledWith(FILE_TREE_CHANNELS.changed, { workspacePath: runtimeResource('one', '/project') })
  })

  it.each(['.docx', '.xlsx', '.pptx'])('refreshes %s preview cache without writing to the target', async ext => {
    mock.data = await mkdtemp(join(tmpdir(), 'janusx-office-cache-test-'))
    mock.resolve.mockResolvedValue({ workspaceId: 'one', runtime: { kind: 'wsl', distro: 'test', root: '/project' }, root: '/project', relative: '' })
    let content = 'first', mtime = 1
    mock.request.mockImplementation(async (_runtime, method) => method === 'fs.stat' ? { isFile: true, mtime, size: content.length } : { base64: Buffer.from(content).toString('base64') })
    const file = await remoteOfficeFile('one', runtimeResource('one', '/project'), '你好' + ext)
    await syncRemoteOfficeFile(file)
    expect(await readFile(file.filePath, 'utf8')).toBe('first')
    content = 'second'; mtime++
    await syncRemoteOfficeFile(file)
    expect(await readFile(file.filePath, 'utf8')).toBe('second')
    expect(mock.request.mock.calls.every(call => ['fs.stat', 'fs.binary'].includes(call[1]))).toBe(true)
    retainRemoteOfficePreview('test-lease', file)
    releaseRemoteOfficePreviews(['test-lease'])
    await vi.waitFor(async () => { await expect(readFile(file.filePath)).rejects.toThrow() })
  })
})
