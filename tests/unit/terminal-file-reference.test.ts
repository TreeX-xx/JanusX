import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_FILE_DRAG_TYPE,
  canDropWorkspaceFileReference,
  clearWorkspaceFileDragData,
  getActiveWorkspaceFileDragData,
  readWorkspaceFileDragData,
  readWorkspaceFileReferenceDrop,
  setWorkspaceFileDragData,
} from '../../src/renderer/src/lib/terminal-file-reference'

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    get types() { return [...values.keys()] },
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
  } as DataTransfer
}

describe('workspace entry drag payload', () => {
  afterEach(() => {
    clearWorkspaceFileDragData()
    vi.unstubAllGlobals()
  })

  it('allows a directory to be copied into a terminal as a reference', () => {
    const dataTransfer = createDataTransfer()
    setWorkspaceFileDragData(dataTransfer, {
      type: 'directory',
      name: 'my docs',
      path: 'docs\\my docs',
      workspacePath: 'C:\\workspace',
    })

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(dataTransfer.getData('text/plain')).toBe('@"docs/my docs"')
    expect(readWorkspaceFileDragData(dataTransfer)).toEqual({
      type: 'directory',
      name: 'my docs',
      path: 'docs/my docs',
      workspacePath: 'C:\\workspace',
    })
  })

  it('allows files to choose copy for terminal drops or move for folder drops', () => {
    const dataTransfer = createDataTransfer()
    const payload = {
      type: 'file' as const,
      name: 'demo.ts',
      path: 'src/demo.ts',
      workspacePath: 'C:\\workspace',
    }
    setWorkspaceFileDragData(dataTransfer, payload)

    expect(dataTransfer.effectAllowed).toBe('copyMove')
    expect(getActiveWorkspaceFileDragData()).toEqual(payload)
    clearWorkspaceFileDragData()
    expect(getActiveWorkspaceFileDragData()).toBeNull()
  })

  it('recovers only the active file drag with a matching plain-text reference', () => {
    const source = createDataTransfer()
    const payload = { type: 'file' as const, name: 'my file.ts', path: 'src/my file.ts', workspacePath: '/repo', quote: 'kept context' }
    setWorkspaceFileDragData(source, payload)
    const plain = createDataTransfer()
    plain.setData('text/plain', source.getData('text/plain'))
    const read = vi.spyOn(plain, 'getData')
    expect(canDropWorkspaceFileReference(plain)).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(readWorkspaceFileReferenceDrop(plain)).toEqual(payload)

    plain.setData('text/plain', '@other.ts')
    expect(readWorkspaceFileReferenceDrop(plain)).toBeNull()
    plain.setData('text/plain', source.getData('text/plain'))
    plain.setData('Files', '')
    expect(canDropWorkspaceFileReference(plain)).toBe(false)
    expect(readWorkspaceFileReferenceDrop(plain)).toBeNull()

    source.setData(WORKSPACE_FILE_DRAG_TYPE, '')
    expect(readWorkspaceFileReferenceDrop(source)).toEqual(payload)
    clearWorkspaceFileDragData()
    expect(readWorkspaceFileReferenceDrop(source)).toBeNull()
  })

  it.each(['dragend', 'dragstart', 'blur'])('drops the temporary reference on %s', event => {
    const renderer = new EventTarget()
    vi.stubGlobal('window', renderer)
    const source = createDataTransfer()
    setWorkspaceFileDragData(source, { type: 'file', name: 'demo.ts', path: 'src/demo.ts', workspacePath: '/repo' })
    source.setData(WORKSPACE_FILE_DRAG_TYPE, '')
    renderer.dispatchEvent(new Event(event))
    expect(getActiveWorkspaceFileDragData()).toBeNull()
    expect(readWorkspaceFileReferenceDrop(source)).toBeNull()
  })
})
