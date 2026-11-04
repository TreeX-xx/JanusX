import { useEffect } from 'react'
import { Download, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'
import { probeCli, useCliReadiness } from '@/stores/cli-readiness'
import type { TerminalPreset } from '@/types'

/** Only new-terminal entry points show installation status; running tabs do not. */
export function TerminalInstallBadge({ preset, compact = false }: { preset: TerminalPreset; compact?: boolean }) {
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
  if (!needsSetup) return null
  return <span role="img" aria-label={label} title={label} style={{ position: 'absolute', right: compact ? 4 : 8, bottom: compact ? 4 : 8, display: 'grid', placeItems: 'center', width: compact ? 12 : 14, height: compact ? 12 : 14, color: 'var(--shell-muted)' }}>
    {probe.installed ? <Wrench size={compact ? 10 : 12} strokeWidth={1.5} aria-hidden /> : <Download size={compact ? 10 : 12} strokeWidth={1.5} aria-hidden />}
  </span>
}
