import { useEffect } from 'react'
import { Download, CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'
import { probeCli, useCliReadiness } from '@/stores/cli-readiness'
import { TerminalPresetIcon, type TerminalPresetIconProps } from './TerminalPresetIcon'

/** Only new-terminal entry points show installation status; running tabs do not. */
export function TerminalLaunchIcon(props: TerminalPresetIconProps) {
  const { preset } = props
  const { i18n } = useTranslation()
  const remoteId = useWorkspaceStore(s => {
    const workspace = s.workspaces.find(w => w.id === s.activeWorkspaceId)
    return workspace?.runtime && workspace.runtime.kind !== 'windows' ? workspace.id : undefined
  })
  const key = `${remoteId ?? 'local'}:${preset}`
  const probe = useCliReadiness(s => s.probes[key])
  useEffect(() => {
    if (preset === 'shell') return
    const refresh = () => { void probeCli(preset, remoteId) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [preset, remoteId])
  const needsSetup = preset !== 'shell' && probe && !probe.runnable && !probe.error
  const label = i18n.language.startsWith('zh')
    ? probe?.installed ? '需要修复，点击准备' : '未安装，点击安装'
    : probe?.installed ? 'Needs repair. Click to set up' : 'Not installed. Click to install'
  return <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
    <TerminalPresetIcon {...props} />
    {needsSetup && <span role="img" aria-label={label} title={label} style={{ position: 'absolute', right: -5, bottom: -4, display: 'grid', placeItems: 'center', width: 13, height: 13, borderRadius: '50%', background: 'var(--shell-canvas)', color: 'var(--shell-muted)', boxShadow: '0 0 0 1px var(--shell-border-soft)' }}>
      {probe.installed ? <CircleAlert size={10} aria-hidden /> : <Download size={10} aria-hidden />}
    </span>}
  </span>
}
