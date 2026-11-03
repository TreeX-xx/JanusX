// Note: .agents/notes/workbench/git-workbench.md
import { useCallback, useContext, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from 'lucide-react'
import { normalizeGitCwd, useGitStore } from '@/stores/git'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n/useI18n'
import type { GitFileChange, GitHistoryScope } from '../../../shared/ipc/git'
import { WorkspaceTransition } from './shared/WorkspaceTransition'
import { PromptDialog } from './common/PromptDialog'
import { ToolbarMenu } from './viewers/ToolbarMenu'
import { ViewerActive } from './viewers/ViewerToolbar'
import { GitChanges } from './git/GitChanges'
import { GitHistory } from './git/GitHistory'
import { getGitViewState, useGitViewState } from './git/view-state'
import styles from './GitPanel.module.css'

type RemoteAction = 'push' | 'pull'
type GitState = ReturnType<typeof useGitStore.getState>

export function GitPanel({ active = true }: { active?: boolean }) {
  const git = useGitStore()
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspace = useWorkspaceStore(s => s.workspaces.find(item => item.id === activeWorkspaceId))
  const worktreePath = useWorktreeStore(s => activeWorkspaceId ? s.activePaths[activeWorkspaceId] : undefined)
  const cwd = worktreePath ?? workspace?.path
  const scope = cwd ? `${activeWorkspaceId}:${normalizeGitCwd(cwd)}` : ''
  const { t } = useI18n('git')
  const [remoteAction, setRemoteAction] = useState<RemoteAction | null>(null)
  const [discardTarget, setDiscardTarget] = useState<GitFileChange | null>(null)
  const currentStatus = cwd && git.statusCwd === normalizeGitCwd(cwd) ? git.status : null
  const scopePending = !!cwd && (git.statusCwd !== normalizeGitCwd(cwd) || git.logCwd !== normalizeGitCwd(cwd) || git.statusLoading || git.logLoading)
  const refresh = useCallback(() => {
    if (!cwd) return
    void useGitStore.getState().fetchStatus(cwd)
    void useGitStore.getState().fetchLog(cwd, getGitViewState(scope)?.historyScope)
  }, [cwd, scope])
  useEffect(() => {
    if (!cwd) return
    const current = useGitStore.getState()
    if (current.statusCwd !== normalizeGitCwd(cwd)) void current.fetchStatus(cwd)
    void current.fetchLog(cwd, getGitViewState(scope)?.historyScope)
  }, [cwd, scope])
  useEffect(() => { setRemoteAction(null); setDiscardTarget(null) }, [scope, active])
  const stageFile = useCallback((file: GitFileChange) => {
    if (!cwd || useGitStore.getState().loading) return
    const action = file.staged ? useGitStore.getState().unstageFiles : useGitStore.getState().stageFiles
    void action(cwd, [file.path])
  }, [cwd])
  const openFile = useCallback((file: GitFileChange) => {
    if (cwd) void useEditorStore.getState().openFile(`${cwd}/${file.path}`.replace(/\\/g, '/'), cwd)
  }, [cwd])
  const discardFile = useCallback((file: GitFileChange) => setDiscardTarget(file), [])
  const commit = useCallback(async (message: string) => {
    if (!cwd || useGitStore.getState().loading) return false
    const succeeded = await useGitStore.getState().commitChanges(cwd, message)
    if (succeeded && useGitStore.getState().logCwd === normalizeGitCwd(cwd)) void useGitStore.getState().fetchLog(cwd, getGitViewState(scope)?.historyScope)
    return succeeded
  }, [cwd, scope])

  if (!cwd) return <div className={styles.emptyState}><p className={styles.emptyTitle}>{t('noWorkspace')}</p></div>
  if (currentStatus?.isRepo === false) return <div className={styles.emptyState}><GitBranch className={styles.emptyIcon} size={22} /><p className={styles.emptyTitle}>{t('notRepository.title')}</p><p className={styles.emptyHint}>{t('notRepository.hint')}</p></div>

  const confirmRemote = async () => {
    if (!remoteAction || useGitStore.getState().loading) return
    const action = remoteAction === 'push' ? git.pushChanges : git.pullChanges
    const succeeded = await action(cwd)
    if (succeeded && useGitStore.getState().logCwd === normalizeGitCwd(cwd)) {
      void useGitStore.getState().fetchLog(cwd, getGitViewState(scope)?.historyScope)
      setRemoteAction(null)
    }
  }
  return <ViewerActive.Provider value={active && !scopePending}>
    <div className={styles.panel} aria-busy={git.loading}>
      <header className={styles.repositoryHeader}>
        <div className={styles.branchInfo}><GitBranch size={15} /><div><strong title={currentStatus?.branch.name}>{currentStatus?.branch.name ?? '…'}</strong><span title={currentStatus?.branch.upstream ?? ''}>{currentStatus?.branch.upstream ?? t('branch.upstreamUnset')}</span></div></div>
        <div className={styles.syncActions}>
          <button type="button" disabled={git.loading || scopePending} onClick={() => setRemoteAction('pull')} title={t('remote.pullButton')}><ArrowDown size={13} />{t('remote.pullButton')}{!!currentStatus?.branch.behind && <span>{currentStatus.branch.behind}</span>}</button>
          <button type="button" disabled={git.loading || scopePending} onClick={() => setRemoteAction('push')} title={t('remote.pushButton')}><ArrowUp size={13} />{t('remote.pushButton')}{!!currentStatus?.branch.ahead && <span>{currentStatus.branch.ahead}</span>}</button>
          <ToolbarMenu label={t('more')}><button type="button" disabled={scopePending || git.loading} onClick={refresh}><RefreshCw size={13} />{t('refresh')}</button></ToolbarMenu>
        </div>
      </header>
      <WorkspaceTransition scopeKey={scope} pending={scopePending} active={active} name={workspace?.name}>
        <GitWorkspace key={scope} scope={scope} cwd={cwd} git={git} active={active} refresh={refresh} onStage={stageFile} onOpen={openFile} onDiscard={discardFile} onCommit={commit} />
      </WorkspaceTransition>
    </div>
    {discardTarget && active && <PromptDialog open confirmOnly tone="danger" title={t('discard.title')} description={<>{t('discard.description', { path: discardTarget.path })}{git.error && <p className={styles.danger}>{git.error}</p>}</>}
      confirmText={git.loading ? t('remote.executing') : t('discard.confirm')} onCancel={() => setDiscardTarget(null)} onConfirm={() => {
        if (useGitStore.getState().loading) return
        void git.discardChange(cwd, discardTarget.path).then(success => { if (success) setDiscardTarget(null) })
      }} />}
    {remoteAction && active && <PromptDialog open confirmOnly title={t(`remote.${remoteAction}.title`)}
      description={<><p>{t(`remote.${remoteAction}.description`)}</p><p className={styles.remoteInfo}>{currentStatus?.branch.name} → {currentStatus?.branch.upstream ?? t('branch.upstreamUnset')}</p><p>{t(`remote.${remoteAction}.hint`)}</p>{git.error && <p className={styles.danger}>{git.error}</p>}</>}
      confirmText={git.loading ? t('remote.executing') : t(`remote.${remoteAction}.actionLabel`)} onCancel={() => setRemoteAction(null)} onConfirm={() => void confirmRemote()} />}
  </ViewerActive.Provider>
}

function GitWorkspace({ scope, cwd, git, active, refresh, onStage, onOpen, onDiscard, onCommit }: {
  scope: string; cwd: string; git: GitState; active: boolean; refresh: () => void
  onStage: (file: GitFileChange) => void; onOpen: (file: GitFileChange) => void; onDiscard: (file: GitFileChange) => void; onCommit: (message: string) => Promise<boolean>
}) {
  const { t } = useI18n('git')
  const { state, update, saveScroll } = useGitViewState(scope)
  const hostActive = useContext(ViewerActive)
  const changes = git.status?.changes ?? []
  const uniqueChanges = new Set(changes.map(file => file.path)).size
  const bulkStage = (staged: boolean) => {
    if (git.loading) return
    void (staged ? git.unstageFiles : git.stageFiles)(cwd, changes.filter(file => file.staged === staged).map(file => file.path))
  }
  const filterHistory = (historyScope: GitHistoryScope) => {
    update({ historyScope, selectedCommit: null, historyScroll: 0 })
    void git.fetchLog(cwd, historyScope)
  }
  return <div className={styles.workspace}>
    <div className={styles.tabs} role="tablist" aria-label={t('views')}>
      {(['changes', 'history'] as const).map(tab => <button type="button" key={tab} id={`git-tab-${tab}`} role="tab" aria-selected={state.tab === tab} aria-controls={`git-view-${tab}`} tabIndex={state.tab === tab ? 0 : -1}
        onClick={() => update({ tab })} onKeyDown={e => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault()
            const next = e.key === 'Home' ? 'changes' : e.key === 'End' ? 'history' : tab === 'changes' ? 'history' : 'changes'
            update({ tab: next }); document.getElementById(`git-tab-${next}`)?.focus()
          }
        }}>{t(`tabs.${tab}`)}{tab === 'changes' && <span className={styles.count}>{uniqueChanges}</span>}</button>)}
    </div>
    {git.error && <div className={styles.error} role="alert">{git.error}<button type="button" onClick={refresh}>{t('retry')}</button></div>}
    <ViewerActive.Provider value={hostActive && state.tab === 'changes'}>
      <GitChanges cwd={cwd} files={changes} loading={git.loading} visible={state.tab === 'changes'} state={state} update={update} saveScroll={saveScroll} onStage={onStage} onBulk={bulkStage} onDiscard={onDiscard} onOpen={onOpen} onCommit={onCommit} />
    </ViewerActive.Provider>
    <GitHistory cwd={cwd} commits={git.commits} loading={git.logLoading} moreLoading={git.logLoadingMore} hasMore={!!git.logCursor} error={git.logError} visible={state.tab === 'history'} active={active && hostActive}
      state={state} update={update} saveScroll={saveScroll} onScope={filterHistory} onMore={() => void git.loadMoreLog(cwd)} onRefresh={refresh} />
  </div>
}
