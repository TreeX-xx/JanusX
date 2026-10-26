import { useEffect, useRef, useState } from 'react'
import { terminalDraftSchema } from '@janusx/plugin-sdk'
import { ModalFrame } from '@/components/shared/ModalFrame'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useAppStore } from '@/stores/app'
import { launchTerminalPreset } from '@/lib/terminal-launch'
import type { TerminalPreset } from '@/types'
import { usePluginSnapshot } from './plugin-runtime'
import styles from './PluginWorkspaceHandoffHost.module.css'

interface Draft { pluginId: string; name: string; projectId: string; root: string; text: string }
const canonical = (path: string) => window.electron.platform === 'win32' ? path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() : path.replace(/\/+$/, '')
function currentProject(projectId: string, root: string) {
  const state = useWorkspaceStore.getState(), workspace = state.workspaces.find(item => item.id === projectId)
  const path = useWorktreeStore.getState().activePaths[projectId] ?? workspace?.path
  return state.activeWorkspaceId === projectId && path && canonical(path) === canonical(root)
}

/** All terminal creation stays behind an editable host dialog and a fresh user click. */
export function PluginWorkspaceHandoffHost() {
  const { t } = useI18n('plugins')
  const [draft, setDraft] = useState<Draft>(), [text, setText] = useState(''), [preset, setPreset] = useState<Exclude<TerminalPreset, 'shell'>>('codex')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false), starting = useRef(false)
  const plugins = usePluginSnapshot()
  const project = useWorkspaceStore(state => state.activeWorkspaceId)
  const roots = useWorktreeStore(state => state.activePaths)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  useEffect(() => window.electron.plugins?.onEvent(({ packet }) => {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)
      || typeof packet.projectId !== 'string' || typeof packet.root !== 'string' || typeof packet.pluginId !== 'string') return
    if (!currentProject(packet.projectId, packet.root)) return
    if (packet.type === 'openDocument' && typeof packet.path === 'string') {
      void window.electron.window.openEditor({ filePath: packet.root.replace(/[\\/]$/, '') + '/' + packet.path, workspacePath: packet.root })
        .then(result => {
          if (result.success) useAppStore.getState().setActiveWorkbench(null)
          else throw new Error(result.error)
        }).catch(() => window.dispatchEvent(new CustomEvent('janusx:plugin-toast', { detail: { source: packet.pluginId, message: t('plugins:handoffFileFailed') } })))
    }
    if (packet.type === 'terminalDraft' && typeof packet.name === 'string' && terminalDraftSchema.safeParse({ text: packet.text }).success) {
      if (pending.current) return
      pending.current = true
      const value = packet as unknown as Draft
      setDraft(value); setText(value.text); setError('')
    }
  }), [t])
  const activeRoot = project ? roots[project] ?? workspaces.find(workspace => workspace.id === project)?.path : undefined
  const eligible = Boolean(draft && project === draft.projectId && activeRoot && canonical(activeRoot) === canonical(draft.root)
    && plugins.plugins.some(record => record.manifest.id === draft.pluginId && record.enabled && !['disabled', 'blocked'].includes(record.state)))
  if (!draft) return null
  const close = () => { if (!starting.current) { pending.current = false; setDraft(undefined) } }
  return <ModalFrame label={t('plugins:handoffTitle')} onClose={close} dismissable={!busy} focusPanelOnReveal zIndex={2200} panelClassName={styles.panel}>
    <h2>{t('plugins:handoffTitle')}</h2><p>{draft.name} · {draft.root}</p><p>{t('plugins:handoffHint')}</p>
    <label>{t('plugins:handoffClient')}<select disabled={busy} value={preset} onChange={event => setPreset(event.target.value as typeof preset)}>
      <option value="codex">Codex</option><option value="claude">Claude Code</option><option value="opencode">OpenCode</option>
      <option value="janus">Janus</option><option value="pi">Pi</option><option value="dsh">DeepSeek</option></select></label>
    <textarea aria-label={t('plugins:handoffDraft')} value={text} maxLength={32000} disabled={busy} onChange={event => setText(event.target.value)} />
    {!eligible && <p role="alert">{t('plugins:handoffScopeChanged')}</p>}{error && <p role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={close}>{t('plugins:cancel')}</button><button disabled={busy || !eligible || !terminalDraftSchema.safeParse({ text }).success}
      onClick={() => { void (async () => {
        if (starting.current || !currentProject(draft.projectId, draft.root)) return
        starting.current = true; setBusy(true); setError('')
        try {
          const input = terminalDraftSchema.parse({ text }).text.replace(/\r\n?/g, '\n')
          // Bracketed paste keeps multiline text from becoming individual submissions. No shell preset or Enter is sent.
          const result = await launchTerminalPreset({ preset, workspaceId: draft.projectId, workspacePath: draft.root,
            initialInput: `\x1b[200~${input}\x1b[201~` })
          if (!result?.ok || !result.prefilled) throw new Error(t('plugins:handoffLaunchFailed'))
          pending.current = false; setDraft(undefined)
        } catch (cause) { setError(cause instanceof Error ? cause.message : t('plugins:handoffLaunchFailed')) }
        finally { starting.current = false; setBusy(false) }
      })() }}>{t(busy ? 'plugins:handoffLaunching' : 'plugins:handoffLaunch')}</button></footer>
  </ModalFrame>
}
