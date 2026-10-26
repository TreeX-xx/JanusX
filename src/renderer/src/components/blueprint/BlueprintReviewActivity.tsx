import { CircleCheck, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { attentionRoots } from '@/features/blueprint/attention-model'
import type { Blueprint } from '../../../../../plugins/blueprint/src/shared/janus/types'
import { useBlueprintReview, useBlueprintReviewStore } from '@/stores/blueprint-review'
import { useBlueprintActivity, useBlueprintActivityStore } from '@/stores/blueprint-review-activity'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import styles from './BlueprintReviewActivity.module.css'

function WorkspaceActivity({ root, blueprint, multiple, onOpen }: { root: string; blueprint: Blueprint | null; multiple: boolean; onOpen?: (root: string, element: HTMLElement) => void }) {
  const { t, currentLanguage } = useI18n('blueprint')
  const view = useBlueprintReview(root)
  const fast = useBlueprintActivity(root)
  const statusError = useBlueprintActivityStore(state => state.errors[root])
  const sourceError = useBlueprintReviewStore(state => state.errors[root])
  const automatic = fast ? fast.automatic : view?.automatic
  const enabled = fast?.automaticSettings?.enabled ?? Boolean(automatic && automatic.phase !== 'disabled')
  const activities = fast?.activities ?? view?.activities
  const manual = activities?.find(item => item.trigger !== 'automatic')
  const activity = manual ?? activities?.find(item => item.noteId === automatic?.currentNote?.id)
  const readError = statusError || (!fast && !automatic ? sourceError : '')
  const loading = !readError && !activity && (!automatic || enabled && automatic.phase === 'disabled') && fast?.automaticSettings?.enabled !== false
  const awaitingReview = view?.items.filter(item => item.awaitingReview) ?? []
  const hasReviewItems = Boolean(awaitingReview.length || automatic?.targets?.length || view?.structure?.issues.length)
  const unresolved = Boolean(awaitingReview.length || view?.structure?.issues.length || automatic?.targets?.some(target => target.state === 'failed' || target.state === 'incomplete'))
  if (!enabled && !loading && !activity && !readError && !unresolved && !hasReviewItems) return null

  const needsAttention = Boolean(!manual && (readError || (!activity && !['checking', 'reviewing'].includes(automatic?.phase ?? '')
    && (automatic?.phase === 'failed' || automatic?.phase === 'unavailable' || unresolved))))
  const retryCount = new Set([...(automatic?.targets?.filter(target => target.retrying || target.state === 'failed' || target.state === 'incomplete').map(target => target.noteId) ?? []),
    ...awaitingReview.map(item => item.noteId),
    ...(view?.structure?.issues.map(issue => issue.noteId ?? 'file:' + issue.path) ?? [])]).size
  const running = !needsAttention && (loading || automatic?.phase === 'checking' || automatic?.phase === 'reviewing' || Boolean(activity))
  const summary = automatic?.lastRun
  const currentTargets = automatic?.targets
  const currentAttention = currentTargets?.length ? t('blueprint:attention.currentReview', {
    failed: currentTargets.filter(target => target.state === 'failed').length,
    incomplete: currentTargets.filter(target => target.state === 'incomplete').length,
  }) : ''
  let lastRun = ''
  if (summary) {
    lastRun = summary.outcome === 'no-changes' ? t('blueprint:review.activity.noChanges')
      : t('blueprint:review.activity.summary', { reviewed: summary.reviewed, findings: summary.findings })
    if (summary.failed) lastRun += ` · ${t('blueprint:review.activity.failedCount', { count: summary.failed })}`
    if (summary.incomplete) lastRun += ` · ${t('blueprint:review.activity.incompleteCount', { count: summary.incomplete })}`
    lastRun = `${t('blueprint:review.activity.previousRound')}${lastRun}`
  }
  const labels = { structure: t('review.structure.checking'), reading: t('blueprint:review.reading'), analyzing: t('blueprint:review.analyzing'), verifying: t('blueprint:review.verifying'), publishing: t('blueprint:review.savingSuggestions') }
  const snapshots = [blueprint?.noteSnapshot]
  const noteTitle = (manual ? undefined : automatic?.currentNote?.title)
    ?? snapshots.flatMap(snapshot => snapshot?.entries ?? []).find(entry => entry.doc?.id === activity?.noteId)?.doc?.title
    ?? view?.items.find(item => item.noteId === activity?.noteId)?.source?.path
    ?? ''
  let title = enabled ? t('blueprint:review.activity.enabled') : activity ? t('blueprint:review.activity.manual') : t('blueprint:review.activity.results')
  let meta = enabled ? t('blueprint:review.activity.commits', { count: automatic?.commits, threshold: automatic?.threshold }) : ''
  let detail = lastRun || t(enabled ? 'blueprint:review.activity.waiting' : 'blueprint:review.activity.resultsAvailable')
  if (loading) { title = t(enabled ? 'blueprint:review.activity.enabled' : 'blueprint:review.activity.title'); meta = t('blueprint:review.activity.loading'); detail = t('blueprint:review.activity.loadingDetail') }
  if (manual) {
    title = t('review.activity.manual'); meta = labels[manual.phase]; detail = noteTitle
  } else if (automatic?.phase === 'checking') {
    title = t('blueprint:review.activity.running'); meta = t('blueprint:review.activity.checking'); detail = t('blueprint:review.auto_checking')
  } else if (automatic?.phase === 'reviewing') {
    title = t('blueprint:review.activity.running')
    meta = automatic.total ? t('blueprint:review.activity.progress', { count: automatic.completed ?? 0, total: automatic.total }) : t('blueprint:review.auto_reviewing', { remaining: automatic.remaining })
    detail = [activity ? labels[activity.phase] : t('blueprint:review.activity.preparing'), noteTitle].filter(Boolean).join(' · ')
  } else if (activity) {
    detail = [t('blueprint:review.activity.manual'), labels[activity.phase], noteTitle].filter(Boolean).join(' · ')
  }
  if (needsAttention) {
    title = readError ? t(enabled ? 'blueprint:review.activity.enabled' : 'blueprint:review.activity.readFailed') : enabled ? t('blueprint:review.activity.enabled') : t('blueprint:attention.automatic')
    meta = t(readError ? 'blueprint:review.activity.readFailed' : 'blueprint:review.activity.attention')
    const reason = automatic?.reason ?? (automatic?.targets?.some(target => target.state === 'failed') ? 'review-failed' : 'coverage-incomplete')
    detail = readError ? t('blueprint:review.activity.retrying') : t(`blueprint:review.activity.reason.${reason}`)
  }
  const commits = enabled && automatic && !loading ? t('review.activity.commits', { count: automatic.commits, threshold: automatic.threshold }) : ''
  const progress = commits && !manual && automatic?.phase === 'reviewing' && !needsAttention ? meta : ''
  if (commits && !manual) meta = commits
  const workspaceName = root.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? root
  const finishedAt = summary ? t('blueprint:review.activity.finishedAt', { time: new Date(summary.finishedAt).toLocaleString(currentLanguage) }) : ''
  const tooltip = [root, title, meta, progress, currentAttention, detail, manual && enabled ? t('review.activity.enabled') : '', lastRun && detail !== lastRun ? lastRun : '', finishedAt].filter(Boolean).join('\n')
  const Icon = needsAttention ? TriangleAlert : running ? LoaderCircle : summary ? CircleCheck : ShieldCheck
  return <ThemedTooltip label={tooltip} placement="bottom">
    <div className={`blueprint-review-activity ${styles.activity}`} role={onOpen ? 'button' : 'status'} tabIndex={0} data-tone={needsAttention ? 'attention' : running ? 'running' : 'idle'}
      aria-busy={loading || undefined}
      aria-label={onOpen ? t(manual ? 'review.activity.manualDetails' : 'attention.automatic') : undefined}
      onClick={event => onOpen?.(root, event.currentTarget)}
      onKeyDown={event => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(root, event.currentTarget) }
        if (event.key === 'Escape') { event.currentTarget.blur(); event.stopPropagation() }
      }}>
      <Icon className={running ? styles.spinner : styles.icon} size={15} aria-hidden="true" />
      <div className={styles.heading}><span className={styles.title}>{multiple ? `${workspaceName} · ${title}` : title}</span>{progress && <span className={styles.meta}>{progress}</span>}<span className={styles.meta}>{meta}</span>
        {!manual && retryCount > 0 && <span className={styles.retryCount} aria-label={t('attention.group.needsRetry') + ' ' + retryCount}>{retryCount}</span>}</div>
      {running && <span className={styles.track} aria-hidden="true"><span className={!manual && automatic?.phase === 'reviewing' && automatic.total ? styles.progress : styles.indeterminate}
        style={!manual && automatic?.phase === 'reviewing' && automatic.total ? { width: `${100 * (automatic.completed ?? 0) / automatic.total}%` } : undefined} /></span>}
    </div>
  </ThemedTooltip>
}

// Note: quiet toolbar feedback, retained review outcomes and independent suggestion indicators — see .agents/notes/blueprint/maintenance/note-content-review.md
export function BlueprintReviewActivity({ blueprint, workspacePath, onOpen }: { blueprint: Blueprint | null; workspacePath?: string; onOpen?: (root: string, element: HTMLElement) => void }) {
  const roots = attentionRoots(blueprint, workspacePath)
  return <div className={styles.group}>{roots.map(root => <WorkspaceActivity key={root} root={root} blueprint={blueprint} multiple={roots.length > 1} onOpen={onOpen} />)}</div>
}
