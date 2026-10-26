import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { OFFICE_EXTENSIONS, type OfficeFileRequest, type OfficeWatchErrorCode } from '../../shared/office'
import { parseRuntimeResource, runtimeResource, type WorkspaceRuntime } from '../../shared/workspace-runtime'
import { remoteOfficeFile } from './remote-office-cache'

export type ResolveWorkspaceRoot = (workspaceId: string) => Promise<string | undefined>

export interface TrustedOfficeFile {
  remote?: { runtime: Exclude<WorkspaceRuntime, { kind: 'windows' }>; root: string; path: string }
  workspaceId: string
  relPath: string
  rootPath: string
  filePath: string
}

export interface TrustedOfficeWorkspace {
  workspaceId: string
  rootPath: string
}

export class OfficeWorkspaceGuardError extends Error {
  constructor(
    readonly code: Extract<OfficeWatchErrorCode, 'NOT_OFFICE' | 'OUTSIDE_ROOT' | 'IO'>,
    message: string,
  ) {
    super(message)
    this.name = 'OfficeWorkspaceGuardError'
  }
}

function isOutsideRoot(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
}

function isAbsoluteOnAnyPlatform(filePath: string): boolean {
  return isAbsolute(filePath) || /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(filePath)
}

export function createRegisteredWorkspaceRootResolver(workspacesDirectory: string): ResolveWorkspaceRoot {
  return async (workspaceId) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) return undefined

    try {
      const record = JSON.parse(
        await readFile(join(workspacesDirectory, `${workspaceId}.json`), 'utf8'),
      ) as { id?: unknown; path?: unknown; runtime?: WorkspaceRuntime }
      return record.id === workspaceId && typeof record.path === 'string' && record.path.length > 0
        ? record.runtime && record.runtime.kind !== 'windows' ? runtimeResource(workspaceId, record.runtime.root) : record.path
        : undefined
    } catch {
      return undefined
    }
  }
}

export async function resolveTrustedOfficeWorkspace(
  workspaceId: string,
  resolveWorkspaceRoot: ResolveWorkspaceRoot,
): Promise<TrustedOfficeWorkspace> {
  const registeredRoot = await resolveWorkspaceRoot(workspaceId)
  if (!registeredRoot) {
    throw new OfficeWorkspaceGuardError('OUTSIDE_ROOT', 'Workspace is not registered')
  }

  try {
    if (parseRuntimeResource(registeredRoot)) return { workspaceId, rootPath: registeredRoot }
    return { workspaceId, rootPath: await realpath(registeredRoot) }
  } catch {
    throw new OfficeWorkspaceGuardError('IO', 'Workspace is unavailable')
  }
}

export async function resolveTrustedOfficeFile(
  input: OfficeFileRequest,
  resolveWorkspaceRoot: ResolveWorkspaceRoot,
): Promise<TrustedOfficeFile> {
  if (isAbsoluteOnAnyPlatform(input.relPath) || input.relPath.split(/[\\/]+/).includes('..')) {
    throw new OfficeWorkspaceGuardError('OUTSIDE_ROOT', 'Office file is outside the workspace')
  }

  if (!(OFFICE_EXTENSIONS as readonly string[]).includes(extname(input.relPath).toLowerCase())) {
    throw new OfficeWorkspaceGuardError('NOT_OFFICE', 'Unsupported Office file type')
  }

  try {
    let { rootPath } = await resolveTrustedOfficeWorkspace(input.workspaceId, resolveWorkspaceRoot)
    if (parseRuntimeResource(rootPath)) return await remoteOfficeFile(input.workspaceId, input.scopePath || rootPath, input.relPath)
    if (input.scopePath) {
      const scope = await realpath(input.scopePath)
      if (relative(rootPath, scope) !== '') {
        // A sibling checkout must be an actual registered Git worktree; never trust a renderer root.
        const { listWorktrees } = await import('../git/worktrees')
        const worktrees = await listWorktrees(input.workspaceId, rootPath)
        const known = await Promise.all(worktrees.map(item => realpath(item.path).catch(() => '')))
        if (!known.some(path => path && relative(path, scope) === '')) throw new OfficeWorkspaceGuardError('OUTSIDE_ROOT', 'Unregistered worktree')
      }
      rootPath = scope
    }
    const filePath = await realpath(resolve(rootPath, input.relPath))
    const relativePath = relative(rootPath, filePath)
    if (!relativePath || isOutsideRoot(relativePath)) {
      throw new OfficeWorkspaceGuardError('OUTSIDE_ROOT', 'Office file is outside the workspace')
    }

    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new OfficeWorkspaceGuardError('NOT_OFFICE', 'Office target is not a regular file')
    }

    return {
      workspaceId: input.workspaceId,
      relPath: relativePath.split(sep).join('/'),
      rootPath,
      filePath,
    }
  } catch (error) {
    if (error instanceof OfficeWorkspaceGuardError) throw error
    throw new OfficeWorkspaceGuardError('IO', 'Office file is unavailable')
  }
}
