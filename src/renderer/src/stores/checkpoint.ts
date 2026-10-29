import { create } from 'zustand'
import { useWorkspaceStore } from './workspace'
import type { ChangedFileRecord, CheckpointConflict as ConflictInfo, CheckpointSummary, RestoreScope } from '../../../shared/ipc/checkpoint'

export type { ChangedFileRecord, CheckpointSummary, ConflictInfo, RestoreScope }

const listRequests = new Map<string, Promise<CheckpointSummary[]>>()
let requestGeneration = 0
let eventRefresh: Promise<void> | undefined
let eventDirty = false

interface CheckpointStore {
  workspaceCwd: string | null
  checkpoints: CheckpointSummary[]
  selectedCheckpoint: CheckpointSummary | null
  diffs: Record<string, string>
  records: Record<string, ChangedFileRecord[]>
  conflicts: ConflictInfo[]
  loading: boolean
  error: string | null

  fetchCheckpoints: (filter?: { terminalId?: string; engine?: string; cwd?: string; sessionId?: string }) => Promise<void>
  restoreCheckpoint: (checkpointId: string, cwd: string, scope?: RestoreScope) => Promise<void>
  fetchAllDiffs: (checkpointId: string, cwd: string) => Promise<void>
  fetchRecords: (checkpointId: string, cwd: string) => Promise<void>
  deleteCheckpoint: (checkpointId: string, cwd?: string) => Promise<void>
  clearWorkspaceScope: () => void
  setSelected: (checkpoint: CheckpointSummary | null) => void
  clearConflicts: () => void
  subscribeToEvents: () => () => void
}

export const useCheckpointStore = create<CheckpointStore>((set, get) => ({
  workspaceCwd: null,
  checkpoints: [],
  selectedCheckpoint: null,
            diffs: {},
            records: {},
            conflicts: [],
  loading: false,
  error: null,

  fetchCheckpoints: async (filter) => {
    const generation = ++requestGeneration
    const cwd = filter?.cwd?.trim() || null
    if (!cwd) {
      set({
        workspaceCwd: null,
        checkpoints: [],
        selectedCheckpoint: null,
        diffs: {},
        records: {},
        conflicts: [],
        loading: false,
        error: null,
      })
      return
    }

    const previousCwd = get().workspaceCwd
    set({
      workspaceCwd: cwd,
      loading: true,
      error: null,
      ...(previousCwd !== cwd
        ? {
            checkpoints: [],
            selectedCheckpoint: null,
            diffs: {},
    records: {},
            conflicts: [],
          }
        : {}),
    })
    try {
      const key = JSON.stringify([cwd, filter?.terminalId, filter?.engine, filter?.sessionId])
      let request = listRequests.get(key)
      if (!request) {
        request = window.electron.checkpoint.list({ ...filter, cwd }).finally(() => listRequests.delete(key))
        listRequests.set(key, request)
      }
      const cps = await request
      if (generation !== requestGeneration || get().workspaceCwd !== cwd) return
      set({ checkpoints: cps, loading: false })
    } catch (err) {
      if (generation === requestGeneration && get().workspaceCwd === cwd) {
        set({ error: (err as Error).message, loading: false })
      }
    }
  },

  restoreCheckpoint: async (checkpointId, cwd, scope) => {
    set({ loading: true, error: null, conflicts: [] })
    try {
      const result = await window.electron.checkpoint.restore(checkpointId, cwd, scope)
      set({ loading: false, conflicts: result.conflicts })
      await get().fetchCheckpoints({ cwd })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  fetchAllDiffs: async (checkpointId, cwd) => {
    try {
      const diff = await window.electron.checkpoint.diffAll(checkpointId, cwd)
      set((state) => ({
        diffs: { ...state.diffs, [`${checkpointId}:`]: diff },
      }))
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  fetchRecords: async (checkpointId, cwd) => {
    const key = `${checkpointId}:records`
    if (get().records[key]) return
    try {
      const records = await window.electron.checkpoint.records(checkpointId, cwd)
      set((state) => ({
        records: { ...state.records, [key]: records },
      }))
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  deleteCheckpoint: async (checkpointId, cwd) => {
    try {
      await window.electron.checkpoint.delete(checkpointId, cwd)
      set((state) => ({
        checkpoints: state.checkpoints.filter((cp) => cp.id !== checkpointId),
        selectedCheckpoint:
          state.selectedCheckpoint?.id === checkpointId ? null : state.selectedCheckpoint,
      }))
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  clearWorkspaceScope: () =>
    set({
      workspaceCwd: null,
      checkpoints: [],
      selectedCheckpoint: null,
      diffs: {},
      records: {},
      conflicts: [],
      loading: false,
      error: null,
    }),

  setSelected: (checkpoint) => set({ selectedCheckpoint: checkpoint }),
  clearConflicts: () => set({ conflicts: [] }),

  subscribeToEvents: () => {
    const unsub = window.electron.checkpoint.onEvent((event) => {
      if (event.type === 'error') {
        set({ error: event.error ?? 'Checkpoint event failed' })
        return
      }
      const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState()
      const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
      if (!activeWorkspace?.path) {
        get().clearWorkspaceScope()
        return
      }

      eventDirty = true
      if (!eventRefresh) {
        eventRefresh = (async () => {
          while (eventDirty) {
            eventDirty = false
            const state = useWorkspaceStore.getState()
            const workspace = state.workspaces.find(item => item.id === state.activeWorkspaceId)
            if (workspace) await get().fetchCheckpoints({ cwd: workspace.path })
          }
        })().finally(() => { eventRefresh = undefined })
      }
    })
    return unsub
  },
}))
