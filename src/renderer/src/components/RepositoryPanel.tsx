// Note: repository collaboration lives in the right dock; sign-in is also in the workspace menu.
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react'
import { RepositoryIcon } from './ui/RepositoryIcon'
import { Button, Input, Select, Textarea } from '@janusx/ui'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HostedComment, HostedDetail, HostedItem, HostedItemKind, HostedMutation, HostedQuery, HostedRepository, HostedTarget, HostedPage } from '../../../shared/ipc/hosted'
import type { Workspace } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { DEFAULT_REPOSITORY_VIEW, useHostedStore } from '@/stores/hosted'
import { useI18n } from '@/i18n/useI18n'
import { HostedConnectionNotice } from './HostedConnectionNotice'
import { WorktreeComposer } from './WorktreeDialogs'
import { RepositoryOverview } from './RepositoryOverview'
import styles from './RepositoryPanel.module.css'
import { hostedCache, hostedKey, HOSTED_TTL, invalidateHosted } from '@/lib/hosted-cache'
import { useHostedResource } from './useHostedResource'

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function openLink(url: string) { return window.electron.file.openPreviewLink(url) }
function Body({ text }: { text: string }) {
  return <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{text}</ReactMarkdown></div>
}

function ItemForm({ kind, initial, head, base, busy, onSave, onCancel }: {
  kind: HostedItemKind; initial?: HostedDetail; head?: string; base?: string; busy: boolean
  onSave: (mutation: HostedMutation) => Promise<void>; onCancel: () => void
}) {
  const { t } = useI18n('common')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [source, setSource] = useState(head ?? '')
  const [target, setTarget] = useState(base ?? '')
  const [draft, setDraft] = useState(true)
  return <form className={styles.form} onSubmit={event => {
    event.preventDefault()
    void onSave(initial ? { action: 'edit', kind, number: initial.number, title, body }
      : { action: 'create', kind, title, body, ...(kind === 'review' ? { head: source.trim(), base: target.trim(), draft } : {}) })
  }}>
    <label>{t('common:repository.title')}<Input required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
    {!initial && kind === 'review' && <>
      <label>{t('common:repository.head')}<Input required value={source} onChange={event => setSource(event.target.value)} disabled={busy} /></label>
      <label>{t('common:repository.base')}<Input required value={target} onChange={event => setTarget(event.target.value)} disabled={busy} /></label>
      <p className={styles.hint}>{t('common:repository.pushedHint')}</p>
      <label className={styles.inline}><input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} disabled={busy} />{t('common:repository.draft')}</label>
    </>}
    <label>{t('common:repository.body')}<Textarea rows={8} maxLength={60000} value={body} onChange={event => setBody(event.target.value)} disabled={busy} /></label>
    <div className={styles.actions}><Button type="submit" disabled={busy || !title.trim() || (!initial && kind === 'review' && (!source.trim() || !target.trim() || source.trim() === target.trim()))}>{t(initial ? 'common:repository.save' : 'common:repository.create')}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{t('common:repository.cancel')}</Button></div>
  </form>
}

function ItemDetail({ target, kind, number, refreshKey, onBack, onChanged, onDevelop }: {
  target: HostedTarget; kind: HostedItemKind; number: number; refreshKey: number; onBack: () => void; onChanged: (item: HostedDetail) => void; onDevelop: (item: HostedDetail) => void
}) {
  const { t } = useI18n('common')
  const detailResource = useHostedResource<HostedDetail>(hostedKey(target, 'detail', kind, number), () => window.electron.hosted.detail(target, kind, number), HOSTED_TTL.content, refreshKey)
  const discussionResource = useHostedResource<HostedPage<HostedComment>>(hostedKey(target, 'discussion', kind, number), () => window.electron.hosted.discussion(target, kind, number, 1), HOSTED_TTL.content, refreshKey)
  const detail = detailResource.data
  const comments = discussionResource.data?.items ?? []
  const nextPage = discussionResource.data?.nextPage
  const [error, setError] = useState('')
  const [discussionError, setDiscussionError] = useState('')
  const [busy, setBusy] = useState(false)
  const loading = detailResource.loading
  const [moreBusy, setMoreBusy] = useState(false)
  const commentsBusy = discussionResource.loading || moreBusy
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [confirmMerge, setConfirmMerge] = useState(false)
  useEffect(() => { setConfirmMerge(false) }, [refreshKey, detail?.sha, detail?.state])
  const alive = useRef(true)
  const commentRequest = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const loadComments = async (page: number) => {
    if (page === 1) { await discussionResource.refresh(); return }
    const id = ++commentRequest.current
    setMoreBusy(true); setDiscussionError('')
    try {
      const result = await hostedCache.load(hostedKey(target, 'discussion-page', kind, number, page), () => window.electron.hosted.discussion(target, kind, number, page), HOSTED_TTL.content)
      if (!alive.current || commentRequest.current !== id) return
      discussionResource.setData(previous => ({ ...result, items: [...previous?.items ?? [], ...result.items.filter(item => !previous?.items.some(existing => existing.id === item.id))] }))
    } catch (error) { if (alive.current && commentRequest.current === id) setDiscussionError(errorText(error)) }
    finally { if (alive.current && commentRequest.current === id) setMoreBusy(false) }
  }
  const refreshDetail = () => { setConfirmMerge(false); void detailResource.refresh(); void discussionResource.refresh() }
  const mutate = async (mutation: HostedMutation) => {
    if (busy) return
    const session = useHostedStore.getState().revision
    setBusy(true); setError('')
    try {
      await window.electron.hosted.mutate(target, mutation)
      if (session !== useHostedStore.getState().revision) return
      if (mutation.action !== 'comment') invalidateHosted(target, ['list', 'list-page'])
      hostedCache.invalidate(key => {
        const [path, repo, type, itemKind, itemNumber] = JSON.parse(key)
        return path === target.workspacePath && repo === target.repositoryKey && itemKind === kind && itemNumber === number && (mutation.action === 'comment' ? type === 'discussion' || type === 'discussion-page' : type === 'detail')
      })
      if (!alive.current) return
      if (mutation.action === 'comment') setComment('')
      setEditing(false); setConfirmMerge(false)
      if (mutation.action === 'comment') { await discussionResource.refresh(); return }
      const updated = await detailResource.refresh()
      if (alive.current && updated) onChanged(updated)
    } catch (error) { if (session === useHostedStore.getState().revision) hostedCache.handleError(error); if (alive.current) setError(errorText(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div className={styles.detail}>
    <div className={styles.toolbar}><Button variant="ghost" onClick={onBack}><ArrowLeft size={14} />{t('common:repository.back')}</Button><Button variant="ghost" disabled={loading || busy} aria-label={t('common:repository.refresh')} onClick={refreshDetail}><RefreshCw size={14} /></Button></div>
    {(error || detailResource.error) && <div role="alert" className={styles.error}>{error || detailResource.error}</div>}
    {loading && <p role="status" className={styles.hint}>{t(detail ? 'common:repository.refreshing' : 'common:repository.loading')}</p>}
    {detail && <>
      <div className={styles.detailHeading}><span className={styles.state} data-state={detail.state}>{t(`common:repository.state.${detail.state}`)}</span><span className={styles.hint}>#{number}</span><Button variant="ghost" aria-label={t('common:repository.browser')} onClick={() => void openLink(detail.url).catch(error => setError(errorText(error)))}><ExternalLink size={14} /></Button></div>
      <h3 className={styles.itemTitle}>{detail.title}</h3>
      <div className={styles.hint}>{detail.author}{detail.assignees.length > 0 ? ' · ' + t('common:repository.assignees') + ': ' + detail.assignees.join(', ') : ''}</div>
      {detail.head && <div className={styles.branch}>{detail.head} → {detail.base}</div>}
      {detail.labels.length > 0 && <div className={styles.labels}>{detail.labels.map(label => <span key={label}>{label}</span>)}</div>}
      {editing ? <ItemForm kind={kind} initial={detail} busy={busy} onSave={mutate} onCancel={() => setEditing(false)} /> : <Body text={detail.body || t('common:repository.noBody')} />}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy || loading} onClick={() => setEditing(!editing)}>{t('common:repository.edit')}</Button>
        {detail.state !== 'merged' && <Button variant="secondary" disabled={busy || loading} onClick={() => void mutate({ action: detail.state === 'closed' ? 'reopen' : 'close', kind, number })}>{t(detail.state === 'closed' ? 'common:repository.reopen' : 'common:repository.closeItem')}</Button>}
        {kind === 'issue' && <Button variant="secondary" onClick={() => onDevelop(detail)}>{t('common:repository.develop')}</Button>}
        {kind === 'review' && detail.state === 'open' && detail.sha && <Button variant="secondary" disabled={busy || loading} onClick={async () => { setConfirmMerge(false); const latest = await detailResource.refresh(); if (alive.current && latest?.state === 'open' && latest.sha) setConfirmMerge(true) }}>{t('common:repository.merge')}</Button>}
      </div>
      {confirmMerge && <div className={styles.confirm}>
        <p>{t('common:repository.mergeConfirm', { number, head: detail.head, base: detail.base })}</p><code>{detail.sha?.slice(0, 12)}</code>
        <div className={styles.actions}><Button disabled={busy || loading} onClick={() => void mutate({ action: 'merge', kind: 'review', number, sha: detail.sha! })}>{t('common:repository.confirmMerge')}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmMerge(false)}>{t('common:repository.cancel')}</Button></div>
      </div>}
      {kind === 'review' && <section className={styles.section}>
        <h4>{t('common:repository.checks')}</h4>
        {detail.checksError && <div role="alert" className={styles.error}>{detail.checksError}</div>}
        {detail.checks.length === 0 && <p className={styles.hint}>{t('common:repository.noChecks')}</p>}
        {detail.checks.map((check, index) => <div key={index} className={styles.check}><span data-state={check.state}>{t(`common:repository.check.${check.state}`)}</span><span>{check.name}</span>{check.url && <Button variant="ghost" aria-label={t('common:repository.browser')} onClick={() => void openLink(check.url!).catch(error => setError(errorText(error)))}><ExternalLink size={12} /></Button>}</div>)}
      </section>}
      <section className={styles.section}>
        <h4><MessageSquare size={14} />{t('common:repository.discussion')}</h4>
        {comments.map(comment => <article key={comment.id} className={styles.comment}><div className={styles.hint}>{comment.author} · {new Date(comment.createdAt).toLocaleString()}</div><Body text={comment.body} /></article>)}
        {comments.length === 0 && !commentsBusy && !discussionError && !discussionResource.error && <p className={styles.hint}>{t('common:repository.noComments')}</p>}
        {(discussionError || discussionResource.error) && <div role="alert" className={styles.error}>{discussionError || discussionResource.error}<Button variant="ghost" onClick={() => void loadComments(discussionError ? nextPage ?? 1 : 1)}>{t('common:hosted.retry')}</Button></div>}
        {nextPage && <Button variant="ghost" disabled={commentsBusy} onClick={() => void loadComments(nextPage)}>{t('common:repository.loadMore')}</Button>}
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void mutate({ action: 'comment', kind, number, body: comment }) }}>
          <Textarea aria-label={t('common:repository.comment')} placeholder={t('common:repository.comment')} rows={3} value={comment} onChange={event => setComment(event.target.value)} maxLength={60000} disabled={busy} />
          <Button type="submit" disabled={busy || !comment.trim()}>{t('common:repository.sendComment')}</Button>
        </form>
      </section>
    </>}
  </div>
}

function RepositoryBrowser({ workspace, active }: { workspace: Workspace; active: boolean }) {
  const { t } = useI18n('common')
  const view = useHostedStore(state => state.views[workspace.path] ?? DEFAULT_REPOSITORY_VIEW)
  const connection = useHostedStore(state => state.connections[workspace.path])
  const revision = useHostedStore(state => state.revision)
  const [repo, setRepo] = useState<HostedRepository | null>(null)
  const [connecting, setConnecting] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [create, setCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issue, setIssue] = useState<HostedDetail | null>(null)
  const [search, setSearch] = useState(view.query.search)
  const list = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const worktrees = useWorktreeStore(state => state.worktreesByWorkspace[workspace.id])
  const worktreePath = useWorktreeStore(state => state.activePaths[workspace.id] ?? workspace.path)
  const target = useRef<HostedTarget>({ workspacePath: workspace.path, repositoryKey: '' })
  if (repo && target.current.repositoryKey !== repo.key) target.current = { workspacePath: workspace.path, repositoryKey: repo.key }
  const currentTarget = target.current
  const listKey = active && repo && connection?.status === 'ready' && view.tab !== 'overview' ? hostedKey(currentTarget, 'list', view.query) : null
  const listResource = useHostedResource<HostedPage<HostedItem>>(listKey, () => window.electron.hosted.browse(currentTarget, view.query), HOSTED_TTL.content, reload)
  const items = listResource.data?.items ?? []
  const nextPage = listResource.data?.nextPage
  const truncated = listResource.data?.truncated
  const loading = listResource.loading || moreLoading
  const setItems = (update: (previous: HostedItem[]) => HostedItem[]) => listResource.setData(previous => ({ ...previous, nextPage: previous?.nextPage ?? null, items: update(previous?.items ?? []) }))
  const updateView = (patch: Partial<typeof view>) => useHostedStore.getState().setView(workspace.path, { ...(useHostedStore.getState().views[workspace.path] ?? DEFAULT_REPOSITORY_VIEW), ...patch })
  const setQuery = (patch: Partial<HostedQuery>) => {
    const query = { ...view.query, ...patch, page: 1 }
    if (JSON.stringify(query) === JSON.stringify(view.query)) return
    updateView({ tab: query.kind, query, selected: null, scrollTop: 0 }); setCreate(false)
  }
  const switchTab = (tab: typeof view.tab) => {
    if (tab === view.tab) return
    setCreate(false)
    if (tab === 'overview') updateView({ tab, selected: null })
    else {
      const saved = view.tabs?.[tab]
      updateView({ tab, selected: null, query: saved?.query ?? { ...DEFAULT_REPOSITORY_VIEW.query, kind: tab }, scrollTop: saved?.scrollTop ?? 0 })
      setSearch(saved?.query.search ?? '')
    }
  }
  useEffect(() => {
    if (!active) return
    let alive = true
    setConnecting(true); setError('')
    void Promise.all([window.electron.hosted.repository(workspace.path), useHostedStore.getState().ensure(workspace.path)])
      .then(([repository]) => { if (alive) { setRepo(repository); setConnecting(false) } })
      .catch(error => { if (alive) { setError(errorText(error)); setConnecting(false) } })
    return () => { alive = false }
  }, [workspace.path, active, revision])
  useEffect(() => {
    const sequence = request
    sequence.current++; setMoreLoading(false); setError('')
    return () => { sequence.current++ }
  }, [listKey])
  useEffect(() => {
    if (list.current) list.current.scrollTop = view.scrollTop
    // Restore after loading or returning, not while the user is scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listResource.data, view.tab, view.selected])
  const more = async () => {
    if (loading || !nextPage) return
    const id = request.current
    setMoreLoading(true); setError('')
    try {
      const result = await hostedCache.load(hostedKey(currentTarget, 'list-page', { ...view.query, page: nextPage }), () => window.electron.hosted.browse(currentTarget, { ...view.query, page: nextPage }), HOSTED_TTL.content)
      if (request.current !== id) return
      listResource.setData(previous => ({ ...result, items: [...previous?.items ?? [], ...result.items.filter(item => !previous?.items.some(old => old.number === item.number))] }))
    } catch (error) { if (request.current === id) setError(errorText(error)) }
    finally { if (request.current === id) setMoreLoading(false) }
  }
  const refresh = async () => {
    setError('')
    try {
      const repository = await window.electron.hosted.repository(workspace.path)
      if (!alive.current) return
      if (repository?.key !== repo?.key) { if (repo) invalidateHosted(currentTarget, undefined, true); setRepo(repository); updateView({ selected: null, scrollTop: 0 }); return }
      if (repo) invalidateHosted(currentTarget, undefined, false, false)
      setReload(value => value + 1)
    } catch (error) { if (alive.current) setError(errorText(error)) }
  }
  if (!active) return null
  return <div className={styles.panel}>
    <header className={styles.header}>
      <div className={styles.repoName}><RepositoryIcon size={16} strokeWidth={1.6} aria-hidden="true" /><strong>{repo?.fullName ?? workspace.name}</strong></div>
      <div className={styles.toolbar}><span className={styles.hint}>{repo ? (repo.provider === 'github' ? 'GitHub' : 'GitLab') + ' · origin' : t('common:repository.titlePanel')}</span>
        <Button variant="ghost" aria-label={t('common:repository.refresh')} disabled={connecting || loading || saving} onClick={() => void refresh()}><RefreshCw size={14} /></Button>
        {repo && <Button variant="ghost" aria-label={t('common:repository.browser')} onClick={() => void openLink(repo.url).catch(error => setError(errorText(error)))}><ExternalLink size={14} /></Button>}
      </div>
    </header>
    {connecting && !repo && <p className={styles.empty} role="status">{t('common:repository.loading')}</p>}
    {!connecting && !repo && <p className={styles.empty}>{t('common:repository.unsupported')}</p>}
    {repo && connection && connection.status !== 'ready' && <div className={styles.empty}><HostedConnectionNotice connection={connection} onRetry={() => { void useHostedStore.getState().refresh(workspace.path).catch(error => setError(errorText(error))) }} onLogin={() => useHostedStore.getState().signIn(workspace.path)} /></div>}
    {(error || listResource.error) && <div role="alert" className={styles.error}>{error || listResource.error}</div>}
    {repo && connection?.status === 'ready' && <>
      <div className={styles.tabs} role="tablist" aria-label={t('common:repository.titlePanel')} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click()
      }}>
        {(['overview', 'issue', 'review'] as const).map(kind => <button type="button" key={kind} role="tab" disabled={saving} tabIndex={view.tab === kind ? 0 : -1} aria-selected={view.tab === kind} onClick={() => switchTab(kind)}>{kind === 'overview' ? t('common:repository.overview') : kind === 'issue' ? 'Issues' : repo.provider === 'github' ? 'Pull Requests' : 'Merge Requests'}</button>)}
      </div>
      {view.tab === 'overview' ? <RepositoryOverview key={repo.key} target={currentTarget} refreshKey={reload + revision} /> : view.selected ? <div className={styles.scroll}><ItemDetail key={repo.key + ':' + view.selected.kind + ':' + view.selected.number + ':' + revision} target={currentTarget} {...view.selected} refreshKey={reload}
        onBack={() => { updateView({ selected: null }); requestAnimationFrame(() => { if (list.current) list.current.scrollTop = view.scrollTop }) }}
        onChanged={updated => setItems(previous => {
          const matches = view.query.state === 'all' || updated.state === view.query.state || (view.query.state === 'open' && updated.state === 'draft')
          if (!matches) return previous.filter(item => item.number !== updated.number)
          return previous.some(item => item.number === updated.number) ? previous.map(item => item.number === updated.number ? updated : item) : [updated, ...previous]
        })} onDevelop={setIssue} /></div>
        : create ? <div className={styles.scroll}><div className={styles.content}><h3>{t(view.query.kind === 'issue' ? 'common:repository.newIssue' : repo.provider === 'github' ? 'common:repository.newPr' : 'common:repository.newMr')}</h3>
          <ItemForm kind={view.query.kind} busy={saving} head={worktrees?.find(tree => tree.path === worktreePath)?.branch ?? ''} base={worktrees?.find(tree => tree.isMain)?.branch ?? ''}
            onCancel={() => setCreate(false)} onSave={async mutation => {
              setSaving(true); setError('')
              const session = useHostedStore.getState().revision
              try {
                const result = await window.electron.hosted.mutate(currentTarget, mutation)
                if (session !== useHostedStore.getState().revision) return
                invalidateHosted(currentTarget, ['list', 'list-page'])
                if (!alive.current) return
                setCreate(false); updateView({ selected: { kind: mutation.kind, number: result.number } }); setReload(value => value + 1)
              } catch (error) { if (session === useHostedStore.getState().revision) hostedCache.handleError(error); if (alive.current) setError(errorText(error)) } finally { if (alive.current) setSaving(false) }
            }} /></div></div>
          : <>
            <form className={styles.search} onSubmit={event => { event.preventDefault(); setQuery({ search: search.trim() }) }}><Input aria-label={t('common:repository.search')} placeholder={t('common:repository.search')} value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /><Button type="submit" variant="ghost" aria-label={t('common:repository.search')}><Search size={14} /></Button><Button variant="secondary" aria-label={t('common:repository.create')} onClick={() => setCreate(true)}><Plus size={14} />{t('common:repository.create')}</Button></form>
            <div className={styles.filters}>
              <Select className={styles.filterSelect} role="combobox" ariaLabel={t('common:repository.status')} value={view.query.state} onChange={value => setQuery({ state: value as HostedQuery['state'] })} options={(['open', 'closed', ...(view.query.kind === 'review' ? ['merged' as const] : []), 'all'] as const).map(state => ({ value: state, label: t(`common:repository.state.${state}`) }))} />
              <Select className={styles.filterSelect} role="combobox" ariaLabel={t('common:repository.filterLabel')} value={view.query.filter} onChange={value => setQuery({ filter: value as HostedQuery['filter'] })} options={(['all', 'created', 'assigned'] as const).map(filter => ({ value: filter, label: t(`common:repository.filter.${filter}`) }))} />
              
            </div>
            <div ref={list} className={styles.scroll} onScroll={event => { if (!useHostedStore.getState().views[workspace.path]?.selected) updateView({ scrollTop: event.currentTarget.scrollTop }) }}>
              {items.map(item => <button key={item.number} type="button" className={styles.item} onClick={() => updateView({ selected: { kind: item.kind, number: item.number }, scrollTop: list.current?.scrollTop ?? view.scrollTop })}>
                <span className={styles.itemTitle}>{item.title}</span><span className={styles.itemMeta}><span>#{item.number}</span><span data-state={item.state}>{t(`common:repository.state.${item.state}`)}</span><span>{item.author}</span></span>
                {item.labels.length > 0 && <span className={styles.labels}>{item.labels.slice(0, 3).map(label => <span key={label}>{label}</span>)}</span>}
              </button>)}
              {loading && <p className={items.length ? styles.hint : styles.empty} role="status">{t(items.length ? 'common:repository.refreshing' : 'common:repository.loading')}</p>}
              {!loading && !error && !listResource.error && items.length === 0 && <p className={styles.empty}>{t('common:repository.empty')}</p>}
              {nextPage && <div className={styles.content}><Button variant="secondary" disabled={loading} onClick={() => void more()}>{t('common:repository.loadMore')}</Button></div>}
              {truncated && <p className={styles.empty}>{t('common:repository.searchLimit')}</p>}
            </div>
          </>}
    </>}
    {issue && <WorktreeComposer workspace={workspace} initialIssue={{ ...issue, state: issue.state === 'closed' ? 'closed' : 'open' }} onClose={() => setIssue(null)} />}
  </div>
}

export function RepositoryPanel({ active = true }: { active?: boolean }) {
  const revision = useHostedStore(state => state.revision)
  const workspace = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId))
  const { t } = useI18n('common')
  return workspace ? <RepositoryBrowser key={workspace.path + ':' + revision} workspace={workspace} active={active} /> : <p className={styles.empty}>{t('common:repository.noWorkspace')}</p>
}
