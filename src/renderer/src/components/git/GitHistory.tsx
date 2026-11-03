import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, Copy, GitCommitHorizontal, Search, X } from 'lucide-react'
import type { GitCommitChange, GitHistoryCommit, GitHistoryScope } from '../../../../shared/ipc/git'
import { useI18n } from '@/i18n/useI18n'
import { Select } from '../ui/Select'
import { layoutCommitGraph, type GraphRow } from './graph'
import type { GitViewState } from './view-state'
import styles from '../GitPanel.module.css'

interface Props {
  cwd: string; commits: GitHistoryCommit[]; loading: boolean; moreLoading: boolean; hasMore: boolean; error: string | null; visible: boolean; active: boolean
  state: GitViewState; update: (patch: Partial<GitViewState>) => void; saveScroll: (key: 'historyScroll', value: number) => void
  onScope: (scope: GitHistoryScope) => void; onMore: () => void; onRefresh: () => void
}
const ROW_HEIGHT = 66
const LANE_WIDTH = 14
const COLORS = ['var(--shell-text)', 'var(--shell-muted)', '#7d9cac', '#a591b5', '#8b9d78', '#869fb2']
const color = (index: number) => COLORS[index === 0 ? 0 : 1 + (index - 1) % (COLORS.length - 1)]

export function GitHistory({ cwd, commits, loading, moreLoading, hasMore, error, visible, active, state, update, saveScroll, onScope, onMore, onRefresh }: Props) {
  const { t, currentLanguage } = useI18n('git')
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(currentLanguage, { month: 'short', day: 'numeric' }), [currentLanguage])
  const scroll = useRef<HTMLDivElement>(null)
  const graph = useMemo(() => layoutCommitGraph(commits), [commits])
  const graphWidth = graph.lanes * LANE_WIDTH + 14
  const query = state.historySearch.trim().toLocaleLowerCase()
  const matches = useMemo(() => query ? commits.filter(commit => `${commit.message} ${commit.body ?? ''} ${commit.author} ${commit.hash} ${commit.shortHash} ${commit.refs.map(ref => ref.name).join(' ')}`.toLocaleLowerCase().includes(query)) : [], [commits, query])
  const matchingHashes = useMemo(() => new Set(matches.map(commit => commit.hash)), [matches])
  const matchIndex = matches.findIndex(commit => commit.hash === state.selectedCommit)
  const selected = commits.find(commit => commit.hash === state.selectedCommit)
  const cache = useRef(new Map<string, GitCommitChange[]>())
  const [preview, setPreview] = useState<{ commit: GitHistoryCommit; left: number; top: number; files?: GitCommitChange[] } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewGeneration = useRef(0)
  const closePreview = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    previewGeneration.current++
    setPreview(null)
  }, [])
  useEffect(() => {
    closePreview()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closePreview() }
    window.addEventListener('scroll', closePreview, true)
    window.addEventListener('resize', closePreview)
    document.addEventListener('pointerdown', closePreview, true)
    document.addEventListener('keydown', escape)
    return () => {
      closePreview()
      window.removeEventListener('scroll', closePreview, true)
      window.removeEventListener('resize', closePreview)
      document.removeEventListener('pointerdown', closePreview, true)
      document.removeEventListener('keydown', escape)
    }
  }, [visible, active, closePreview])
  const loadFiles = useCallback(async (hash: string) => {
    const existing = cache.current.get(hash)
    if (existing) return existing
    const files = await window.electron.git.commitChanges(cwd, hash)
    cache.current.set(hash, files)
    return files
  }, [cwd])
  const schedulePreview = (commit: GitHistoryCommit, target: HTMLElement) => {
    closePreview()
    const generation = previewGeneration.current
    hoverTimer.current = setTimeout(() => {
      const rect = target.getBoundingClientRect()
      const position = { left: Math.max(8, rect.left - Math.min(280, window.innerWidth - 16) - 8), top: Math.max(8, Math.min(window.innerHeight - 220, rect.top)) }
      setPreview({ commit, ...position, files: cache.current.get(commit.hash) })
      void loadFiles(commit.hash).then(files => {
        if (previewGeneration.current === generation) setPreview({ commit, ...position, files })
      }, () => {}) // Hover is optional; the explicit detail region offers retry/errors.
    }, 280)
  }
  const initialScroll = useRef(state.historyScroll)
  const restoredScroll = useRef(false)
  useLayoutEffect(() => {
    if (visible && commits.length && !restoredScroll.current && scroll.current) {
      scroll.current.scrollTop = initialScroll.current
      restoredScroll.current = true
    }
  }, [visible, commits.length])
  const locate = (hash: string) => {
    update({ selectedCommit: hash })
    const index = commits.findIndex(commit => commit.hash === hash)
    const container = scroll.current
    if (container && index >= 0) container.scrollTop = Math.max(0, index * ROW_HEIGHT - container.clientHeight / 3)
  }
  const moveMatch = (delta: number) => {
    if (matches.length) locate(matches[(Math.max(matchIndex, 0) + delta + matches.length) % matches.length].hash)
  }
  return <section className={styles.view} hidden={!visible} role="tabpanel" id="git-view-history" aria-labelledby="git-tab-history">
    <div className={styles.historyToolbar}>
      <Select key={visible && active ? 'active' : 'inactive'} role="combobox" ariaLabel={t('history.scope')}
        className={styles.historyScope} dropdownClassName={styles.historyScopeMenu}
        value={state.historyScope} disabled={loading || moreLoading}
        options={[{ value: 'all', label: t('history.all') }, { value: 'current', label: t('history.current') }]}
        onChange={value => { if (scroll.current) scroll.current.scrollTop = 0; onScope(value as GitHistoryScope) }} />
      <span>{t('history.loaded', { count: commits.length })}</span>
    </div>
    <div className={styles.searchToolbar}>
      <label className={styles.search}><Search size={13} aria-hidden="true" /><input aria-label={t('history.search')} placeholder={t('history.search')} value={state.historySearch}
        onChange={e => update({ historySearch: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); moveMatch(e.shiftKey ? -1 : matchIndex < 0 ? 0 : 1) } }} />
        {query && <button type="button" aria-label={t('clearSearch')} onClick={() => update({ historySearch: '' })}><X size={12} /></button>}</label>
      {query && <div className={styles.matchNav}><span aria-live="polite">{Math.max(0, matchIndex + 1)}/{matches.length}</span>
        <button type="button" className={styles.iconButton} aria-label={t('history.previousMatch')} disabled={!matches.length} onClick={() => moveMatch(-1)}><ArrowUp size={13} /></button>
        <button type="button" className={styles.iconButton} aria-label={t('history.nextMatch')} disabled={!matches.length} onClick={() => moveMatch(matchIndex < 0 ? 0 : 1)}><ArrowDown size={13} /></button></div>}
    </div>
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={onRefresh}>{t('refresh')}</button></div>}
    <div ref={scroll} className={styles.scroll} data-testid="git-history-scroll" aria-busy={loading || moreLoading} onScroll={e => saveScroll('historyScroll', e.currentTarget.scrollTop)}>
      <div className={styles.historyCanvas} style={{ minWidth: Math.max(280, graphWidth + 220) }}>
        {commits.map((commit, index) => <button type="button" key={commit.hash} className={styles.commitRow} style={{ height: ROW_HEIGHT }} data-commit-hash={commit.hash}
          data-match={query ? matchingHashes.has(commit.hash) : undefined} aria-pressed={selected?.hash === commit.hash}
          onClick={() => update({ selectedCommit: commit.hash })} onMouseEnter={e => schedulePreview(commit, e.currentTarget)} onMouseLeave={closePreview}>
          <GraphLane row={graph.rows[index]} width={graphWidth} head={commit.refs.some(ref => ref.kind === 'head')} />
          <span className={styles.commitText}><span className={styles.commitSubject}>{commit.message}</span>
            <span className={styles.commitMeta}><span>{commit.author}</span><time dateTime={commit.date}>{dateFormatter.format(new Date(commit.date))}</time><code>{commit.shortHash}</code></span>
            <span className={styles.refs}>{commit.refs.map(ref => <span key={`${ref.kind}:${ref.name}`} data-kind={ref.kind} title={ref.name}>{ref.name}</span>)}</span>
          </span>
        </button>)}
      </div>
      {!commits.length && <p className={styles.message}>{loading ? t('history.loading') : t('history.empty')}</p>}
      {hasMore && <button type="button" className={styles.loadMore} disabled={loading || moreLoading} onClick={onMore}>{moreLoading ? t('history.loading') : t('history.loadMore')}</button>}
      {!hasMore && commits.length > 0 && <p className={styles.historyEnd}>{t('history.end')}</p>}
    </div>
    {selected && <CommitDetail key={selected.hash} commit={selected} loadFiles={loadFiles} onClose={() => update({ selectedCommit: null })} />}
    {preview && visible && active && createPortal(<div role="tooltip" className={styles.commitPreview} style={{ top: preview.top, left: preview.left }}>
      <strong>{preview.commit.message}</strong><p>{preview.commit.shortHash} · {preview.commit.author}</p>
      {preview.files ? <><p>{t('history.filesCount', { count: preview.files.length })}</p>{preview.files.slice(0, 5).map(file => <div className={styles.previewFile} key={file.path}>{file.path}</div>)}</> : <p>{t('history.previewHint')}</p>}
    </div>, document.body)}
  </section>
}

function GraphLane({ row, width, head }: { row: GraphRow; width: number; head: boolean }) {
  const x = (lane: number) => 14 + lane * LANE_WIDTH
  return <svg className={styles.graph} width={width} height={ROW_HEIGHT} aria-hidden="true" data-testid="git-graph">
    {row.segments.map((segment, i) => {
      const y1 = segment.start === 'top' ? 0 : ROW_HEIGHT / 2
      const y2 = segment.end === 'node' ? ROW_HEIGHT / 2 : ROW_HEIGHT
      const from = x(segment.from), to = x(segment.to)
      return <path key={i} d={from === to ? `M ${from} ${y1} V ${y2}` : `M ${from} ${y1} C ${from} ${y1 + 18}, ${to} ${y2 - 18}, ${to} ${y2}`} fill="none" stroke={color(segment.color)} strokeWidth="1.5" />
    })}
    {head && <circle cx={x(row.lane)} cy={ROW_HEIGHT / 2} r="6" fill="none" stroke={color(0)} opacity="0.35" />}
    <circle cx={x(row.lane)} cy={ROW_HEIGHT / 2} r="3.5" fill={color(head ? 0 : row.color)} />
  </svg>
}

function CommitDetail({ commit, loadFiles, onClose }: { commit: GitHistoryCommit; loadFiles: (hash: string) => Promise<GitCommitChange[]>; onClose: () => void }) {
  const { t, currentLanguage } = useI18n('git')
  const [files, setFiles] = useState<GitCommitChange[] | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let cancelled = false
    setError('')
    loadFiles(commit.hash).then(value => { if (!cancelled) setFiles(value) }, reason => { if (!cancelled) setError(String(reason.message ?? reason)) })
    return () => { cancelled = true }
  }, [commit.hash, loadFiles, retry])
  return <section className={styles.detail} data-testid="git-commit-detail" aria-label={t('history.detail')}>
    <div className={styles.detailHeader}><GitCommitHorizontal size={14} /><strong>{commit.shortHash}</strong>
      <button type="button" className={styles.iconButton} aria-label={t('history.copyHash')} onClick={() => { void navigator.clipboard.writeText(commit.hash).then(() => setCopied(true), () => setError(t('history.copyFailed'))) }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
      <button type="button" className={styles.iconButton} aria-label={t('closeDetail')} onClick={onClose}><X size={14} /></button></div>
    <div className={styles.detailScroll}>
      <h3 className={styles.detailSubject}>{commit.message}</h3><p className={styles.detailMeta}>{commit.author} · {new Date(commit.date).toLocaleString(currentLanguage)}</p>
      {commit.body && <p className={styles.detailBody}>{commit.body}</p>}
      {commit.parents.length > 1 && <p className={styles.detailMeta}>{t('history.mergeHint')}</p>}
      {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button></div>}
      {!files && !error && <p className={styles.message}>{t('history.loadingChanges')}</p>}
      {files && <><div className={styles.detailTotals}><span>{t('history.filesCount', { count: files.length })}</span><span className={styles.add}>+{files.reduce((sum, file) => sum + (file.additions ?? 0), 0)}</span><span className={styles.del}>−{files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)}</span></div>
        {files.map(file => <div key={file.path} className={styles.commitFile}><span className={styles.fileStatus} data-status={file.status}>{file.status}</span><span title={file.path}>{file.path}</span><span className={styles.add}>{file.additions === null ? '—' : `+${file.additions}`}</span><span className={styles.del}>{file.deletions === null ? '—' : `−${file.deletions}`}</span></div>)}</>}
    </div>
  </section>
}
