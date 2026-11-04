import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTurnChangesStore } from '@/stores/turn-changes'

export function useTerminalLifecycle(): void {
  const updateTerminal = useWorkspaceStore((state) => state.updateTerminal)
  const removeTerminal = useWorkspaceStore((state) => state.removeTerminal)
  const setLoadState = useAppStore((state) => state.setLoadState)

  // AI CLI flow heuristic: main process emits running/wait transitions while
  // the pty produces output. Shell terminals never emit status events.
  useEffect(() => window.electron.terminal.onStatus(({ id, status }) => {
    updateTerminal(id, { status, updatedAt: Date.now() })
  }), [updateTerminal])

  // exit 0 -> remove from list (no misleading lingering state);
  // non-zero -> mark error and retain so the user can see/retry.
  useEffect(() => window.electron.terminal.onExit(({ id, exitCode }) => {
    if (exitCode === 0) {
      removeTerminal(id)
      useTurnChangesStore.getState().clearTerminal(id)
      return
    }
    updateTerminal(id, { status: 'error', exitCode, updatedAt: Date.now() })
  }), [updateTerminal, removeTerminal])

  useEffect(() => window.electron.terminal.onFocus(({ id }) => {
    const store = useWorkspaceStore.getState()
    if (store.terminals.some((terminal) => terminal.id === id)) {
      store.setActiveTerminal(id)
      setLoadState('terminal-active')
      return
    }
    const workspaceId = Object.entries(store.terminalSnapshots).find(([, snapshot]) =>
      snapshot.terminals.some((terminal) => terminal.id === id),
    )?.[0]
    if (!workspaceId) return
    store.setActiveWorkspace(workspaceId)
    requestAnimationFrame(() => {
      useWorkspaceStore.getState().setActiveTerminal(id)
      setLoadState('terminal-active')
    })
  }), [setLoadState])

  useEffect(() => window.electron.terminal.onCreated((event) => {
    const store = useWorkspaceStore.getState()
    if (store.terminals.some((terminal) => terminal.id === event.id)) return
    store.addTerminalForWorkspace({
      ...(event.conversationEnabled ? { conversationEnabled: true, conversationInitialView: event.initialView ?? 'terminal' } : {}),
      id: event.id, workspaceId: event.workspaceId, cwd: event.cwd, preset: event.preset,
      shell: event.shell, name: `${event.preset} terminal`, autoCommand: event.preset,
      pid: event.pid, status: 'wait', updatedAt: Date.now(),
    })
    if (store.activeWorkspaceId === event.workspaceId) setLoadState('terminal-active')
  }), [setLoadState])
}
