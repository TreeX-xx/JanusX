import { useEffect } from 'react'
import { useWorktreeStore } from '@/stores/worktree'
import { useHostedStore } from '@/stores/hosted'
import { useRightToolStore } from '@/stores/right-tools'
import { useI18n } from '@/i18n/useI18n'

export function WorkspaceHostedMenuItem({ workspacePath, className, onSelect }: { workspacePath: string; className: string; onSelect: () => void }) {
  const identity = useWorktreeStore(state => state.identities[workspacePath])
  const provider = identity?.host === 'github.com' ? 'github' : 'gitlab'
  const connection = useHostedStore(state => state.connections[workspacePath] ?? Object.values(state.connections).find(connection => connection?.provider === provider && connection.status === 'ready'))
  const { t } = useI18n('common')
  const supported = identity?.host === 'github.com' || identity?.host === 'gitlab.com'
  useEffect(() => {
    if (supported) void useHostedStore.getState().ensure(workspacePath).catch(() => {})
  }, [supported, workspacePath])
  if (!supported) return null
  const ready = connection?.status === 'ready'
  const label = ready ? t('common:repository.open') : t('common:repository.connect', { platform: identity.host === 'github.com' ? 'GitHub' : 'GitLab' })
  return <button type="button" className={className} onClick={() => {
    onSelect()
    if (ready) useRightToolStore.getState().openTool('repository')
    else useHostedStore.getState().signIn(workspacePath)
  }}>{label}</button>
}
