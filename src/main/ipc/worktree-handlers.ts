import { app, ipcMain, type BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { WORKTREE_CHANNELS, type WorktreeCreateInput, type WorktreeDeleteInput } from '../../shared/ipc/worktree'
import {
  abortMerge,
  cancelCreateWorktree,
  createWorktree,
  deleteBranch,
  diffBranchToBase,
  fetchRepoAvatar,
  getRepoIdentity,
  gitCommonDir,
  isWorktreeDirty,
  listWorktrees,
  mergeBranchToBase,
  removeWorktree,
  worktreeBranch,
  worktreeListSignature,
} from '../git/worktrees'
import { agentSessionRegistry } from '../sessions/session-registry'
import { parseRuntimeResource } from '../../shared/workspace-runtime'

const WORKTREE_WATCH_DEBOUNCE_MS = 250
const WORKTREE_POLL_MS = 4000

interface WatchedWorktrees {
  workspaceId: string
  workspacePath: string
  commonDir: string
  worktreesDir: string
  /** Recursive watch on the admin dir; null until the dir exists. */
  watcher: FSWatcher | null
  /** Non-recursive watch on the common dir while the admin dir is absent. */
  parentWatcher: FSWatcher | null
  debounceTimer: NodeJS.Timeout | null
  lastSignature: string | null
  resyncing: boolean
}

const watchedByWorkspace = new Map<string, WatchedWorktrees>()
let pollTimer: NodeJS.Timeout | null = null
let getWindow: () => BrowserWindow | null = () => null

function sendToRenderer(channel: string, payload: unknown): void {
  const window = getWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, payload)
}

function closeWatcher(watcher: FSWatcher | null): void {
  try {
    watcher?.close()
  } catch {
    // Best-effort; a dead watcher carries no state worth reporting.
  }
}

function disposeEntry(entry: WatchedWorktrees): void {
  closeWatcher(entry.watcher)
  closeWatcher(entry.parentWatcher)
  entry.watcher = null
  entry.parentWatcher = null
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.debounceTimer = null
}

async function resyncEntry(entry: WatchedWorktrees): Promise<void> {
  if (entry.resyncing) return
  entry.resyncing = true
  try {
    // The admin dir may have appeared since the parent watch started.
    await attachAdminWatcher(entry)
    const worktrees = await listWorktrees(entry.workspaceId, entry.workspacePath)
    const signature = worktreeListSignature(worktrees)
    if (entry.lastSignature === signature) return
    entry.lastSignature = signature
    sendToRenderer(WORKTREE_CHANNELS.changed, {
      workspaceId: entry.workspaceId,
      workspacePath: entry.workspacePath,
      worktrees,
    })
  } catch {
    // A vanishing checkout must never break listing or other watchers.
  } finally {
    entry.resyncing = false
  }
}

function scheduleResync(entry: WatchedWorktrees): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    void resyncEntry(entry)
  }, WORKTREE_WATCH_DEBOUNCE_MS)
  entry.debounceTimer.unref?.()
}

/** Watch the admin dir when present; otherwise watch the common dir for its arrival. */
async function attachAdminWatcher(entry: WatchedWorktrees): Promise<void> {
  if (parseRuntimeResource(entry.workspacePath)) return
  let adminExists = false
  try {
    await access(entry.worktreesDir)
    adminExists = true
  } catch {
    adminExists = false
  }
  if (adminExists) {
    if (entry.watcher) return
    closeWatcher(entry.parentWatcher)
    entry.parentWatcher = null
    try {
      // Recursive so branch switches (admin HEAD rewrites) also surface;
      // the signature diff filters out no-op noise before any push.
      entry.watcher = watch(entry.worktreesDir, { recursive: true }, () => scheduleResync(entry))
      entry.watcher.on('error', () => {
        closeWatcher(entry.watcher)
        entry.watcher = null
      })
    } catch {
      entry.watcher = null
    }
    return
  }
  if (entry.parentWatcher || entry.watcher) return
  try {
    entry.parentWatcher = watch(entry.commonDir, { recursive: false }, (_event, filename) => {
      const name = filename?.toString() ?? ''
      if (name !== 'worktrees' && name !== '') return
      scheduleResync(entry)
    })
    entry.parentWatcher.on('error', () => {
      closeWatcher(entry.parentWatcher)
      entry.parentWatcher = null
    })
  } catch {
    entry.parentWatcher = null
  }
}

/** Best-effort watch registration; never rejects so `list` stays fast and total. */
async function ensureWorktreeWatch(workspaceId: string, workspacePath: string): Promise<void> {
  const existing = watchedByWorkspace.get(workspaceId)
  if (existing) {
    if (existing.workspacePath === workspacePath) return
    disposeEntry(existing)
    watchedByWorkspace.delete(workspaceId)
  }
  let commonDir: string | null = null
  try {
    commonDir = await gitCommonDir(workspacePath)
  } catch {
    commonDir = null
  }
  if (!commonDir) return
  const entry: WatchedWorktrees = {
    workspaceId,
    workspacePath,
    commonDir,
    worktreesDir: join(commonDir, 'worktrees'),
    watcher: null,
    parentWatcher: null,
    debounceTimer: null,
    lastSignature: null,
    resyncing: false,
  }
  watchedByWorkspace.set(workspaceId, entry)
  startPollLoop()
  try {
    await attachAdminWatcher(entry)
    const worktrees = await listWorktrees(workspaceId, workspacePath)
    entry.lastSignature = worktreeListSignature(worktrees)
  } catch {
    // The next poll or fs event heals a failed baseline.
  }
}

function startPollLoop(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    for (const entry of watchedByWorkspace.values()) void resyncEntry(entry)
  }, WORKTREE_POLL_MS)
  pollTimer.unref?.()
}

function unwatchWorkspace(workspaceId: string): void {
  const entry = watchedByWorkspace.get(workspaceId)
  if (!entry) return
  disposeEntry(entry)
  watchedByWorkspace.delete(workspaceId)
  if (watchedByWorkspace.size === 0 && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function disposeWorktreeWatchers(): void {
  for (const entry of watchedByWorkspace.values()) disposeEntry(entry)
  watchedByWorkspace.clear()
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function registerWorktreeHandlers(getMainWindow: () => BrowserWindow | null = () => null): void {
  getWindow = getMainWindow
  ipcMain.handle(
    WORKTREE_CHANNELS.list,
    async (_event, { workspaceId, workspacePath }: { workspaceId: string; workspacePath: string }) => {
      const worktrees = await listWorktrees(workspaceId, workspacePath)
      // Fire-and-forget: the response must not wait for watcher setup.
      void ensureWorktreeWatch(workspaceId, workspacePath)
      return worktrees
    },
  )

  ipcMain.handle(WORKTREE_CHANNELS.identity, async (_event, { workspacePath }: { workspacePath: string }) => {
    return getRepoIdentity(workspacePath)
  })

  ipcMain.handle(WORKTREE_CHANNELS.avatar, async (_event, { workspacePath }: { workspacePath: string }) => {
    const identity = await getRepoIdentity(workspacePath)
    if (!identity) return { dataUrl: null, cached: false }
    return fetchRepoAvatar(app.getPath('userData'), identity.host, identity.upstreamOwner ?? identity.owner)
  })

  ipcMain.handle(WORKTREE_CHANNELS.create, async (_event, input: WorktreeCreateInput) => {
    const created = await createWorktree(
      input.workspacePath,
      {
        name: input.name,
        branch: input.branch,
        startFrom: input.startFrom,
        linkedIssue: input.linkedIssue,
      },
      input.creationId,
    )
    return {
      ...created,
      worktree: { ...created.worktree, workspaceId: input.workspaceId },
    }
  })

  ipcMain.handle(
    WORKTREE_CHANNELS.cancelCreate,
    async (_event, { creationId, workspacePath }: { creationId: string; workspacePath: string }) => {
      return { cancelled: await cancelCreateWorktree(workspacePath, creationId) }
    },
  )

  ipcMain.handle(WORKTREE_CHANNELS.delete, async (_event, input: WorktreeDeleteInput) => {
    const removed = await removeWorktree(
      input.workspacePath,
      input.worktreePath,
      input.force === true,
      input.branch ?? null,
    )
    const archived = new Set<string>()
    for (const cwd of [input.worktreePath, removed.path]) {
      for (const id of agentSessionRegistry.archiveSessionsByCwd(cwd)) archived.add(id)
    }
    return { ...removed, archivedSessions: [...archived] }
  })

  ipcMain.handle(
    WORKTREE_CHANNELS.unwatch,
    async (_event, { workspaceId }: { workspaceId: string; workspacePath: string }) => {
      unwatchWorkspace(workspaceId)
      return { success: true }
    },
  )

  ipcMain.handle(WORKTREE_CHANNELS.status, async (_event, { worktreePath }: { worktreePath: string }) => {
    const [branch, dirty] = await Promise.all([worktreeBranch(worktreePath), isWorktreeDirty(worktreePath)])
    return { branch, dirty }
  })

  ipcMain.handle(
    WORKTREE_CHANNELS.deleteBranch,
    async (_event, { workspacePath, branch, force }: { workspacePath: string; branch: string; force?: boolean }) => {
      await deleteBranch(workspacePath, branch, force === true)
      return { success: true }
    },
  )

  ipcMain.handle(
    WORKTREE_CHANNELS.shipDiff,
    async (_event, { workspacePath, base, branch }: { workspacePath: string; base: string; branch: string }) => {
      return diffBranchToBase(workspacePath, base, branch)
    },
  )

  ipcMain.handle(
    WORKTREE_CHANNELS.shipMerge,
    async (_event, { workspacePath, branch }: { workspacePath: string; branch: string }) => {
      return mergeBranchToBase(workspacePath, branch)
    },
  )

  ipcMain.handle(WORKTREE_CHANNELS.shipAbort, async (_event, { workspacePath }: { workspacePath: string }) => {
    await abortMerge(workspacePath)
    return { success: true }
  })
}
