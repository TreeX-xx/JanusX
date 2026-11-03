import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronDown, ChevronRight, FileDiff, Folder, FolderTree, List, Minus, Plus, Search, X } from 'lucide-react'
import type { GitDiff, GitFileChange } from '../../../../shared/ipc/git'
import { useI18n } from '@/i18n/useI18n'
import { ToolbarMenu } from '../viewers/ToolbarMenu'
import type { GitViewState } from './view-state'
import { GitFilePreview, GitFileStats } from './GitFilePreview'
import styles from '../GitPanel.module.css'

interface Props {
  cwd: string; files: GitFileChange[]; loading: boolean; visible: boolean
  state: GitViewState; update: (patch: Partial<GitViewState>) => void; saveScroll: (key: 'changesScroll', value: number) => void
  onStage: (file: GitFileChange) => void; onBulk: (staged: boolean) => void
  onDiscard: (file: GitFileChange) => void; onOpen: (file: GitFileChange) => void
  onCommit: (message: string) => Promise<boolean>
}

type FileRow = { kind: 'file'; file: GitFileChange; depth: number } | { kind: 'folder'; path: string; name: string; depth: number; count: number }
function treeRows(files: GitFileChange[], collapsed: Record<string, boolean>, group: string): FileRow[] {
  interface Directory { folders: Map<string, Directory>; files: GitFileChange[]; count: number }
  const root: Directory = { folders: new Map(), files: [], count: 0 }
  for (const file of files) {
    let node = root
    node.count++
    for (const part of file.path.split('/').slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [], count: 0 })
      node = node.folders.get(part)!
      node.count++
    }
    node.files.push(file)
  }
  const rows: FileRow[] = []
  const walk = (node: Directory, path: string, depth: number) => {
    for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
      const nextPath = path ? `${path}/${name}` : name
      rows.push({ kind: 'folder', path: nextPath, name, depth, count: child.count })
      if (!collapsed[`${group}:${nextPath}`]) walk(child, nextPath, depth + 1)
    }
    for (const file of node.files) rows.push({ kind: 'file', file, depth })
  }
  walk(root, '', 0)
  return rows
}

export function GitChanges({ cwd, files, loading, visible, state, update, saveScroll, onStage, onBulk, onDiscard, onOpen, onCommit }: Props) {
  const { t } = useI18n('git')
  const scroll = useRef<HTMLDivElement>(null)
  const initialScroll = useRef(state.changesScroll)
  const restoredScroll = useRef(false)
  useLayoutEffect(() => {
    if (visible && !restoredScroll.current && scroll.current) {
      scroll.current.scrollTop = initialScroll.current
      restoredScroll.current = true
    }
  }, [visible])
  const query = state.fileSearch.trim().toLocaleLowerCase()
  const filtered = useMemo(() => files.filter(file => file.path.toLocaleLowerCase().includes(query)), [files, query])
  const groups = useMemo(() => [true, false].map(staged => {
    const group = staged ? 'staged' : 'changes'
    const items = filtered.filter(file => file.staged === staged)
    const rows: FileRow[] = state.fileMode === 'tree' ? treeRows(items, query ? {} : state.collapsed, group)
      : items.map(file => ({ kind: 'file', file, depth: 0 }))
    return { staged, group, items, rows, total: files.filter(file => file.staged === staged).length }
  }), [files, filtered, state.fileMode, state.collapsed, query])
  const selected = files.find(file => `${file.staged}:${file.path}` === state.selectedFile)
  const stagedCount = files.filter(file => file.staged).length
  const canCommit = stagedCount > 0 && !!state.subject.trim() && !loading && !files.some(file => file.status === 'UU')
  const submit = async () => {
    if (!canCommit) return
    const subject = state.subject
    const description = state.description
    if (await onCommit([subject.trim(), description.trim()].filter(Boolean).join('\n\n'))) update({ subject: '', description: '' })
  }
  return <section className={styles.view} hidden={!visible} role="tabpanel" id="git-view-changes" aria-labelledby="git-tab-changes">
    <div className={styles.searchToolbar}>
      <label className={styles.search}><Search size={13} aria-hidden="true" /><input aria-label={t('changes.search')} placeholder={t('changes.search')} value={state.fileSearch} onChange={e => update({ fileSearch: e.target.value })} />
        {state.fileSearch && <button type="button" aria-label={t('clearSearch')} onClick={() => update({ fileSearch: '' })}><X size={12} /></button>}</label>
      <div className={styles.segmented} aria-label={t('changes.view')} role="group">
        <button type="button" aria-label={t('changes.tree')} title={t('changes.tree')} aria-pressed={state.fileMode === 'tree'} onClick={() => update({ fileMode: 'tree' })}><FolderTree size={14} /></button>
        <button type="button" aria-label={t('changes.list')} title={t('changes.list')} aria-pressed={state.fileMode === 'list'} onClick={() => update({ fileMode: 'list' })}><List size={14} /></button>
      </div>
    </div>
    <div ref={scroll} className={styles.scroll} data-testid="git-scroll-region" onScroll={e => saveScroll('changesScroll', e.currentTarget.scrollTop)}>
      {files.length > 0 && groups.map(({ staged, group, rows, items, total }) => <div key={group}>
        <div className={styles.sectionHeader}>
          <button type="button" aria-expanded={!state.collapsed[group]} onClick={() => update({ collapsed: { ...state.collapsed, [group]: !state.collapsed[group] } })}>
            {state.collapsed[group] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}{t(`${group}.title`)}<span className={styles.count}>{query ? `${items.length} / ${total}` : total}</span>
          </button>
          <button type="button" className={styles.iconButton} disabled={!total || loading} aria-label={t(staged ? 'staged.unstageAll' : 'changes.stageAll')} title={t(staged ? 'staged.unstageAll' : 'changes.stageAll')} onClick={() => onBulk(staged)}>{staged ? <Minus size={14} /> : <Plus size={14} />}</button>
        </div>
        {!state.collapsed[group] && <div>
          {Array.from({ length: Math.ceil(rows.length / 16) }, (_, batch) => <div key={batch} className={styles.fileGroup} style={{ containIntrinsicSize: `auto ${Math.min(16, rows.length - batch * 16) * 30}px` }}>
            {rows.slice(batch * 16, (batch + 1) * 16).map(row => row.kind === 'folder'
              ? <button key={`folder:${row.path}`} type="button" className={styles.folderRow} style={{ '--depth': row.depth } as CSSProperties}
                aria-expanded={!!query || !state.collapsed[`${group}:${row.path}`]} title={row.path}
                onClick={() => update({ collapsed: { ...state.collapsed, [`${group}:${row.path}`]: !state.collapsed[`${group}:${row.path}`] } })}>
                {!query && state.collapsed[`${group}:${row.path}`] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={13} /><span>{row.name}</span><span className={styles.count}>{row.count}</span>
              </button>
              : <GitFileItem key={row.file.path} cwd={cwd} file={row.file} depth={row.depth} list={state.fileMode === 'list'} loading={loading}
                selected={state.selectedFile === `${row.file.staged}:${row.file.path}`} onSelect={update} onStage={onStage} onOpen={onOpen} onDiscard={onDiscard} />)}
          </div>)}
          {total === 0 && <p className={styles.groupEmpty}>{t(staged ? 'staged.empty' : 'changes.empty')}</p>}
        </div>}
      </div>)}
      {query && filtered.length === 0 && <p className={styles.message}>{t('changes.noMatch')}</p>}
      {files.length === 0 && <p className={styles.clean}><Check size={15} />{t('clean')}</p>}
    </div>
    {selected && <ChangeDiff key={`${selected.staged}:${selected.path}`} cwd={cwd} file={selected} onClose={() => update({ selectedFile: null })} onOpen={() => onOpen(selected)} />}
    <form className={styles.composer} onSubmit={e => { e.preventDefault(); void submit() }}>
      <input aria-label={t('commit.placeholder')} placeholder={t('commit.placeholder')} value={state.subject} disabled={loading} onChange={e => update({ subject: e.target.value })} onKeyDown={e => { if (e.nativeEvent.isComposing && e.key === 'Enter') e.preventDefault() }} />
      {state.descriptionOpen && <textarea aria-label={t('commit.description')} placeholder={t('commit.description')} rows={3} value={state.description} disabled={loading} onChange={e => update({ description: e.target.value })} />}
      <div className={styles.composerActions}>
        <button type="button" className={styles.textButton} aria-expanded={state.descriptionOpen} onClick={() => update({ descriptionOpen: !state.descriptionOpen })}>{state.descriptionOpen ? <Minus size={12} /> : <Plus size={12} />}{t('commit.description')}</button>
        <button type="submit" className={styles.commitButton} disabled={!canCommit}><Check size={13} />{t('commit.staged', { count: stagedCount })}</button>
      </div>
    </form>
  </section>
}

const GitFileItem = memo(function GitFileItem({ cwd, file, depth, list, loading, selected, onSelect, onStage, onOpen, onDiscard }: {
  cwd: string; file: GitFileChange; depth: number; list: boolean; loading: boolean; selected: boolean
  onSelect: (patch: Partial<GitViewState>) => void; onStage: (file: GitFileChange) => void; onOpen: (file: GitFileChange) => void; onDiscard: (file: GitFileChange) => void
}) {
  const { t } = useI18n('git')
  const slash = file.path.lastIndexOf('/')
  return <GitFilePreview cwd={cwd} file={file} enabled={!loading}><div className={styles.fileRow} data-selected={selected} style={{ '--depth': depth } as CSSProperties}>
    <span className={styles.fileStatus} data-status={file.status}>{file.status === '??' ? '?' : file.status}</span>
    <button type="button" className={styles.fileName} aria-label={file.path} aria-pressed={selected} onClick={() => onSelect({ selectedFile: `${file.staged}:${file.path}` })}>
      <span>{file.path.slice(slash + 1)}</span>{list && slash > -1 && <small>{file.path.slice(0, slash)}</small>}
    </button>
    <GitFileStats file={file} />
    <div className={styles.fileActions}>
      <button type="button" className={styles.iconButton} disabled={loading} aria-label={t(file.staged ? 'changes.unstage' : 'changes.stage')} title={t(file.staged ? 'changes.unstage' : 'changes.stage')} onClick={() => onStage(file)}>{file.staged ? <Minus size={13} /> : <Plus size={13} />}</button>
      <ToolbarMenu label={t('changes.more', { path: file.path })}>
        <button type="button" disabled={file.status === 'D'} onClick={() => onOpen(file)}>{t('changes.open')}</button>
        <button type="button" disabled={loading} className={styles.danger} onClick={() => onDiscard(file)}>{t('changes.discard')}</button>
      </ToolbarMenu>
    </div>
  </div></GitFilePreview>
}, (a, b) => a.cwd === b.cwd && a.depth === b.depth && a.list === b.list && a.loading === b.loading && a.selected === b.selected && a.onSelect === b.onSelect && a.onStage === b.onStage && a.onOpen === b.onOpen && a.onDiscard === b.onDiscard && a.file.path === b.file.path && a.file.status === b.file.status && a.file.staged === b.file.staged && a.file.additions === b.file.additions && a.file.deletions === b.file.deletions)

function ChangeDiff({ cwd, file, onClose, onOpen }: { cwd: string; file: GitFileChange; onClose: () => void; onOpen: () => void }) {
  const { t } = useI18n('git')
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setDiff(null); setError('')
    window.electron.git.diff(cwd, file.path, file.staged).then(value => { if (!cancelled) setDiff(value) }, reason => { if (!cancelled) setError(String(reason.message ?? reason)) })
    return () => { cancelled = true }
  }, [cwd, file])
  return <section className={styles.detail} aria-label={t('changes.diff')} data-testid="git-diff-detail">
    <div className={styles.detailHeader}><FileDiff size={14} /><strong title={file.path}>{file.path.split('/').at(-1)}</strong><span>{t(file.staged ? 'staged.title' : 'changes.title')}</span>
      <button type="button" className={styles.iconButton} aria-label={t('closeDetail')} onClick={onClose}><X size={14} /></button></div>
    <div className={styles.detailScroll}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : !diff ? <p className={styles.message}>{t('history.loadingChanges')}</p>
        : diff.content ? <pre className={styles.patch}>{diff.content.split('\n').map((line, i) => <div key={i} data-line={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : undefined}>{line || ' '}</div>)}</pre>
          : <p className={styles.message}>{t('changes.noDiff')}</p>}
      {diff?.truncated && <p className={styles.message}>{t('changes.truncated')}</p>}
    </div>
    <button type="button" className={styles.detailOpen} disabled={file.status === 'D'} onClick={onOpen}>{t('changes.open')}</button>
  </section>
}
