import type { ShellRestoreManifest } from '../../../shared/ipc/session'
import { launchTerminalPreset } from '@/lib/terminal-launch'
import { useWorkspaceStore } from '@/stores/workspace'
import { runtimeResource } from '../../../shared/workspace-runtime'
import { isTerminalPreset } from '../../../shared/terminalLaunch'

/** Snapshot live plus snapshotted terminals as shell-restore entries. */
export function collectShellRestore(): ShellRestoreManifest {
  const { activeWorkspaceId, workspaces, terminals, terminalSnapshots } = useWorkspaceStore.getState()
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    workspaces: workspaces.map((workspace) => {
      const live = workspace.id === activeWorkspaceId
        ? terminals.filter((terminal) => terminal.workspaceId === workspace.id)
        : []
      const snapshotted = terminalSnapshots[workspace.id]?.terminals ?? []
      const seen = new Map<string, { id: string; cwd: string; preset: string; name: string; shell?: string }>()
      for (const terminal of [...live, ...snapshotted]) {
        if (!terminal.cwd || seen.has(terminal.id)) continue
        seen.set(terminal.id, {
          id: terminal.id,
          cwd: terminal.cwd,
          preset: terminal.preset,
          name: terminal.name,
          ...(terminal.shell ? { shell: terminal.shell } : {}),
        })
      }
      return { workspaceId: workspace.id, terminals: [...seen.values()] }
    }),
  }
}

export async function saveShellRestore(): Promise<void> {
  await window.electron.session.saveLayout(collectShellRestore())
}

/**
 * Local layouts reopen shells. Remote environments enumerate daemon-owned
 * processes and reattach by identity, including after an unclean desktop exit.
 */
export async function restoreShells(): Promise<number> {
  const manifest = await window.electron.session.getLayout().catch(() => null)
  const { workspaces, terminals } = useWorkspaceStore.getState()
  let restored = 0
  for (const workspace of workspaces) {
    if (!workspace.runtime || workspace.runtime.kind === 'windows' || !window.electron.workspaceRuntime) continue
    const saved = manifest?.workspaces.find(entry => entry.workspaceId === workspace.id)?.terminals ?? []
    try {
      const running = await window.electron.workspaceRuntime.terminals(workspace.id)
      for (const process of running) {
        if (process.exitCode !== null && !saved.some(item => item.id === process.id)) continue
        const state = useWorkspaceStore.getState()
        if (state.terminals.some(item => item.id === process.id) || Object.values(state.terminalSnapshots).some(snapshot => snapshot.terminals.some(item => item.id === process.id))) continue
        const previous = saved.find(item => item.id === process.id)
        const result = await launchTerminalPreset({
          terminalId: process.id, attachOnly: true,
          preset: isTerminalPreset(process.preset) ? process.preset : 'shell',
          workspaceId: workspace.id, workspacePath: workspace.path,
          cwd: runtimeResource(workspace.id, process.cwd), name: previous?.name,
          enterTerminalUi: false,
        })
        if (result?.ok) restored += 1
      }
    } catch (error) {
      // Keep the desktop usable when one host is offline. Never replace an
      // unreachable process by running its command a second time.
      console.warn('Remote terminal restore is unavailable', workspace.id, error)
    }
  }
  for (const entry of terminals.length === 0 ? manifest?.workspaces ?? [] : []) {
    const workspace = workspaces.find((item) => item.id === entry.workspaceId)
    if (!workspace || (workspace.runtime && workspace.runtime.kind !== 'windows')) continue
    for (const terminal of entry.terminals) {
      try {
        const result = await launchTerminalPreset({
          preset: 'shell',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          cwd: terminal.cwd,
          name: terminal.name,
          enterTerminalUi: false,
          // 恢复时保留原 shell：改过默认值也不会把旧终端换成新默认。
          ...(terminal.shell ? { shellCommand: terminal.shell } : {}),
        })
        if (result?.ok) restored += 1
      } catch {
        // One bad shell never blocks the rest.
      }
    }
  }
  await window.electron.session.clearLayout().catch(() => undefined)
  return restored
}
