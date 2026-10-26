import React, { Children } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  createPendingFileTreeDelete,
  executeFileTreeDelete,
  FileTreeItem,
  reloadWorkspaceDirectory,
  type FileTreeItemProps,
  type PendingFileTreeDelete,
} from '../../src/renderer/src/components/FileExplorerTool'
import { loadWorkspaceFileTree } from '../../src/renderer/src/features/workspace/actions'
import { PromptDialog, type PromptDialogProps } from '../../src/renderer/src/components/common/PromptDialog'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'
import type { FileNode, Workspace } from '../../src/renderer/src/types'
import { withSynchronousHooks, findElement, type TestElement } from './helpers/tree-render'

const request: PendingFileTreeDelete = {
  workspacePath: 'C:\\workspace',
  targetPath: 'src/original.ts',
  targetName: 'original.ts',
  parentPath: 'src',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function renderConfirmDialog(overrides: Partial<PromptDialogProps> = {}): TestElement {
  return withSynchronousHooks(() => PromptDialog({
    open: true,
    title: '确认删除',
    description: React.createElement('span', null, '确认删除「original.ts」吗？此操作不可恢复。'),
    confirmOnly: true,
    confirmText: '删除',
    tone: 'danger',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }) as TestElement)
}

function renderRow(node: FileNode, overrides: Partial<FileTreeItemProps> = {}): TestElement {
  const props: FileTreeItemProps = {
    node,
    workspacePath: 'C:\\workspace',
    depth: 0,
    activeFilePath: null,
    expanded: false,
    expandedPaths: new Set(),
    loading: false,
    loadingDirectoryPaths: new Set(),
    fileChange: null,
    fileChangeMap: new Map(),
    changedDirs: new Map(),
    onSelect: vi.fn(),
    onToggleDirectory: vi.fn(),
    onOpenFile: vi.fn(),
    onMoveFile: vi.fn(),
    onOpenContextMenu: vi.fn(),
    ...overrides,
  }
  const tree = withSynchronousHooks(() => FileTreeItem(props) as TestElement)
  return findElement(tree, (element) => element.props['data-file-path'] === node.path)
}

async function withMockWindowEnv<T>(
  windowValue: unknown,
  storeState: Partial<ReturnType<typeof useWorkspaceStore.getState>>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalWindow = globalThis.window
  const originalState = useWorkspaceStore.getState()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowValue,
  })
  useWorkspaceStore.setState({ ...originalState, ...storeState } as ReturnType<typeof useWorkspaceStore.getState>)
  try {
    return await fn()
  } finally {
    useWorkspaceStore.setState(originalState)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: originalWindow,
    })
  }
}

describe('file explorer delete confirmation', () => {
  it('captures the original target before the context menu is torn down', () => {
    expect(createPendingFileTreeDelete('C:\\workspace', {
      name: 'original.ts',
      path: 'src/original.ts',
    })).toEqual(request)
  })

  it.each(['Cancel', 'Escape', 'backdrop'])('%s closes the production dialog without deleting', (route) => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const dialog = renderConfirmDialog({ onCancel, onConfirm })

    if (route === 'Cancel') {
      const cancelButton = findElement(dialog, (element) =>
        element.type === 'button' && Children.toArray(element.props.children).join('') === 'common:action.cancel')
      ;(cancelButton.props.onClick as () => void)()
    } else if (route === 'Escape') {
      const modal = findElement(dialog, (element) => element.props.role === 'dialog')
      ;(modal.props.onKeyDown as (event: unknown) => void)({ key: 'Escape', preventDefault: vi.fn() })
    } else {
      const overlay = dialog
      const backdrop = {}
      ;(overlay.props.onMouseDown as (event: unknown) => void)({ target: backdrop, currentTarget: backdrop })
    }

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms exactly once for the captured target', async () => {
    const deleteTarget = vi.fn().mockResolvedValue({ success: true })
    const reloadDirectory = vi.fn().mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const execute = vi.fn(() => executeFileTreeDelete(request, {
      deleteTarget,
      isWorkspaceActive: () => true,
      reloadDirectory,
      onDeleted,
    }))
    const dialog = renderConfirmDialog({ onConfirm: execute })
    const confirmButton = findElement(dialog, (element) =>
      element.type === 'button' && String(element.props.className).includes('blueprint-btn--danger'))

    ;(confirmButton.props.onClick as () => void)()
    await execute.mock.results[0].value

    expect(execute).toHaveBeenCalledTimes(1)
    expect(deleteTarget).toHaveBeenCalledTimes(1)
    expect(deleteTarget).toHaveBeenCalledWith('C:\\workspace', 'src/original.ts')
    expect(onDeleted).toHaveBeenCalledWith('src/original.ts')
    expect(reloadDirectory).toHaveBeenCalledWith('src', 'C:\\workspace')
  })

  it('does not clean or reload the newly active workspace after deletion', async () => {
    const deleteTarget = vi.fn().mockResolvedValue({ success: true })
    const reloadDirectory = vi.fn().mockResolvedValue(undefined)
    const onDeleted = vi.fn()

    await expect(executeFileTreeDelete(request, {
      deleteTarget,
      isWorkspaceActive: () => false,
      reloadDirectory,
      onDeleted,
    })).resolves.toBe(true)

    expect(deleteTarget).toHaveBeenCalledOnce()
    expect(deleteTarget).toHaveBeenCalledWith('C:\\workspace', 'src/original.ts')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(reloadDirectory).not.toHaveBeenCalled()
  })

  it('discards a directory reload that resolves after the active workspace changes', async () => {
    const childrenLoad = deferred<FileNode[]>()
    const loadChildren = vi.fn(() => childrenLoad.promise)
    const oldWorkspace = { id: 'old', path: 'C:\\workspace' } as Workspace
    const newWorkspace = { id: 'new', path: 'C:\\other' } as Workspace
    const oldTree = [{ name: 'src', path: 'src', type: 'directory' }] as FileNode[]
    const newTree = [{ name: 'new.ts', path: 'new.ts', type: 'file' }] as FileNode[]

    await withMockWindowEnv(
      { electron: { fileTree: { children: loadChildren } } },
      {
        workspaces: [oldWorkspace, newWorkspace],
        activeWorkspaceId: oldWorkspace.id,
        activeFilePath: request.targetPath,
        fileTree: oldTree,
      },
      async () => {
        const operation = executeFileTreeDelete(request, {
          deleteTarget: vi.fn().mockResolvedValue({ success: true }),
          isWorkspaceActive: (workspacePath) =>
            useWorkspaceStore.getState().workspaces.find(
              (workspace) => workspace.id === useWorkspaceStore.getState().activeWorkspaceId,
            )?.path === workspacePath,
          reloadDirectory: (path, workspacePath) => reloadWorkspaceDirectory(workspacePath, path),
          onDeleted: () => useWorkspaceStore.setState({ activeFilePath: null }),
        })
        await vi.waitFor(() => expect(loadChildren).toHaveBeenCalledWith('C:\\workspace', 'src'))

        useWorkspaceStore.setState({
          activeWorkspaceId: newWorkspace.id,
          activeFilePath: 'new.ts',
          fileTree: newTree,
        })
        childrenLoad.resolve([{ name: 'old.ts', path: 'src/old.ts', type: 'file' }])
        await operation

        expect(useWorkspaceStore.getState().activeFilePath).toBe('new.ts')
        expect(useWorkspaceStore.getState().fileTree).toBe(newTree)
      },
    )
  })

  it('keeps an expanded directory visible through consecutive root refreshes', async () => {
    const firstChildrenLoad = deferred<FileNode[]>()
    const firstRootLoad = deferred<FileNode[]>()
    const secondRootLoad = deferred<FileNode[]>()
    const child = { name: 'App.tsx', path: 'src/App.tsx', type: 'file' } as FileNode
    const loadChildren = vi.fn(() => firstChildrenLoad.promise)
    const workspace = { id: 'active', path: 'C:\\workspace' } as Workspace
    const rootTree = [{
      name: 'src',
      path: 'src',
      type: 'directory',
      loaded: false,
      hasChildren: true,
      children: [],
    }] as FileNode[]

    await withMockWindowEnv(
      {
        electron: {
          fileTree: {
            children: loadChildren,
            load: vi.fn()
              .mockReturnValueOnce(firstRootLoad.promise)
              .mockReturnValueOnce(secondRootLoad.promise),
          },
        },
      },
      {
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        fileTree: rootTree,
      },
      async () => {
        const directoryReload = reloadWorkspaceDirectory(workspace.path, 'src')
        const duplicateReload = reloadWorkspaceDirectory(workspace.path, 'src')
        await vi.waitFor(() => expect(loadChildren).toHaveBeenCalledTimes(1))
        const firstRootRefresh = loadWorkspaceFileTree(workspace.path)
        const secondRootRefresh = loadWorkspaceFileTree(workspace.path)

        firstChildrenLoad.resolve([child])
        await Promise.all([directoryReload, duplicateReload])
        expect(loadChildren).toHaveBeenCalledTimes(1)

        firstRootLoad.resolve(rootTree)
        secondRootLoad.resolve(rootTree)
        await Promise.all([firstRootRefresh, secondRootRefresh])

        expect(useWorkspaceStore.getState().fileTree[0]).toMatchObject({
          path: 'src',
          loaded: true,
          children: [child],
        })
      },
    )
  })

  it('preserves the neighboring file-row context-menu operation', () => {
    const node = { name: 'original.ts', path: 'src/original.ts', type: 'file' } as FileNode
    const onSelect = vi.fn()
    const onOpenContextMenu = vi.fn()
    const row = renderRow(node, { onSelect, onOpenContextMenu })
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }

    ;(row.props.onContextMenu as (event: unknown) => void)(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(node.path)
    expect(onOpenContextMenu).toHaveBeenCalledWith(event, node)
  })
})
