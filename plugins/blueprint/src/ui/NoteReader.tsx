// Original compact Wiki structure; source reads and actions remain plugin-owned.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import type { Blueprint, BlueprintNode } from '../shared/janus/types'
import type { BlueprintReviewView } from '../shared/ipc/blueprint-review'
import type { NoteRepairInput } from '../shared/note-repair'
import type { NoteVersion } from '../shared/blueprint-attention'
import { blueprintText as t } from './blueprint-text'
import { noteBody, type NoteSource } from './note-body'
import { nodeNoteSnapshot, resolveCompositionNote } from './graph/composition-view'
import { projectArchitecture } from './graph/architecture-view'
import { NoteMarkdown, revealNoteElement } from './NoteMarkdown'
import { NoteReviewPanel, type ReaderVisit } from './NoteReviewPanel'
import { NoteRelations } from './NoteRelations'
import { X } from './WorkbenchIcons'
import './note-wiki.css'

export function NoteReader({ blueprint, node, source, review, busy, visible, visit, select, close, read, repair, runReview, cancelReview, closeFindings, refresh, openFile, children }: {
  blueprint: Blueprint; node: BlueprintNode; source?: NoteSource; review?: BlueprintReviewView; busy: boolean; visible: boolean; visit?: ReaderVisit
  select(id: string, anchor?: string): void; close(): void; read(version: NoteVersion): Promise<void>; repair(input: NoteRepairInput): void
  runReview(): Promise<void>; cancelReview(): Promise<void>; closeFindings(ids: string[]): Promise<void>; refresh(): void
  openFile(path: string, hash?: string): Promise<void>; children?: ReactNode
}) {
  const [tab, setTab] = useState<'body' | 'links'>('body')
  const [raw, setRaw] = useState(false), [notice, setNotice] = useState(''), [marking, setMarking] = useState(false)
  const [shortcutHost, setShortcutHost] = useState<HTMLDivElement | null>(null)
  const actions = useRef<HTMLDetailsElement>(null), body = useRef<HTMLDivElement>(null)
  const snapshot = nodeNoteSnapshot(blueprint, node.id)
  const projection = useMemo(() => projectArchitecture(blueprint), [blueprint])
  const current = source && source.note.meta.id === node.note?.id ? source : undefined
  const document = useMemo(() => current && node.sourceUri ? noteBody(current, node.sourceUri) : undefined, [current, node.sourceUri])
  const unread = review?.updates?.entries.find(entry => entry.noteId === node.note?.id)?.unread
  const consumedVisit = useRef<number>()
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (actions.current?.open && !actions.current.contains(event.target as Node)) actions.current.open = false }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [])
  useEffect(() => { if (actions.current) actions.current.open = false }, [tab, node.id])
  const mark = async () => {
    if (!current || marking) return
    setMarking(true)
    try { await read({ noteId: current.note.meta.id, hash: current.sha256, path: current.relPath }) }
    catch (error) { setNotice(String(error)) }
    finally { setMarking(false) }
  }
  const revealAnchor = (anchor: string) => {
    const element = [...(body.current?.querySelectorAll<HTMLElement>('[data-note-anchor]') ?? [])].find(element => element.dataset.noteAnchor === anchor)
    if (element) revealNoteElement(element)
    else setNotice(t('reader.anchorMissing', { anchor }))
  }
  useEffect(() => {
    if (!visit || !current || consumedVisit.current === visit.sequence) return
    consumedVisit.current = visit.sequence
    setTab('body'); setRaw(false)
    if (visit.intent !== 'body') return
    void mark()
    const frame = requestAnimationFrame(() => {
      if (visit.anchor) revealAnchor(visit.anchor)
      else body.current?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [visit, current])
  const open = (uri: string, anchor?: string) => {
    const target = resolveCompositionNote(blueprint, node.id, uri)
    if (!target) { setNotice(t('reader.unresolved') + ': ' + uri); return }
    if (target !== node.id) { select(target, anchor); return }
    setTab('body'); setRaw(false)
    if (anchor) requestAnimationFrame(() => revealAnchor(anchor))
  }
  const renderLink = (reading: NoteSource): Components['a'] => ({ href, children }) => {
    if (!href) return <span>{children}</span>
    // External URLs remain visible text under the offline plugin page policy.
    if (/^https?:\/\//i.test(href)) return <span className="bp-note-external-link" title={href}>{children}</span>
    const readingUri = snapshot?.entries.find(entry => entry.doc?.id === reading.note.meta.id)?.uri ?? node.sourceUri
    const mention = snapshot?.mentions.find(edge => edge.sourceUri === readingUri && edge.destinations.includes(href))
    return <button type="button" className="bp-note-link" onClick={() => {
      if (href.startsWith('#')) {
        try { open(readingUri!, decodeURIComponent(href.slice(1))) } catch { setNotice(t('reader.invalidAnchor')) }
      } else if (!reading.matchesSnapshot) setNotice(t('reader.staleLinks'))
      else if (href.startsWith('note://')) { const [uri, anchor] = href.split('#'); try { open(uri, anchor ? decodeURIComponent(anchor) : undefined) } catch { setNotice(t('reader.invalidAnchor')) } }
      else if (mention?.targetUri) open(mention.targetUri, mention.anchor)
      else setNotice(t('reader.unresolved') + ': ' + href)
    }}>{children}</button>
  }
  const metadata = current?.note.meta
  const fields = metadata && <dl className="bp-note-wiki__metadata"><dt>{t('detailPanel.kind')}</dt><dd>{metadata.kind}</dd><dt>{t('detailPanel.status')}</dt><dd>{metadata.lifecycle}</dd>{metadata.moduleState && <><dt>{t('detailPanel.moduleState')}</dt><dd>{metadata.moduleState}</dd></>}{metadata.updated && <><dt>{t('detailPanel.updatedAt')}</dt><dd>{metadata.updated}</dd></>}</dl>
  return <aside className="bp-node-detail" data-visible={visible ? 'true' : 'false'} aria-hidden={!visible || undefined}>
    <div className="bp-node-detail__header"><div className="bp-node-detail__heading">
      <div className="bp-node-detail__eyebrow">{node.kind} · {node.lifecycle}</div>
      <h2 className="bp-node-detail__title">{node.title}</h2>
      <div className="bp-node-detail__summary"><span>{t('noteKind.' + node.kind)}</span><span>{node.lifecycle}</span>{node.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
    </div><button type="button" className="bp-panel-close" onClick={close} aria-label={t('ariaLabel.closeNodeDetail')}><X size={16} /></button></div>
    <div className="bp-node-detail__scroll">
      {projection.roles[node.id] && <details className="bp-browser-related"><summary>{t('browse.related')}</summary><div className="bp-composition"><strong>{t('architecture.related')}</strong>{!projection.related[node.id]?.length && <p>{t('architecture.noRelated')}</p>}{projection.related[node.id]?.map(row => <div className="bp-note-relation" key={row.nodeId ?? row.uri}><button disabled={!row.nodeId} onClick={() => row.nodeId && select(row.nodeId)}>{row.nodeId ? blueprint.nodes[row.nodeId]?.title : row.uri}</button><small>{row.via}</small></div>)}</div></details>}
      <section className="bp-note-wiki bp-note-wiki--compact" aria-label={t('reader.engineeringWiki')}>
        {snapshot?.coverage.status !== 'complete' && <div className="bp-note-wiki__scope">{t('attention.syncing')}</div>}
        {notice && <div className="bp-note-warning" role="status">{notice}<button onClick={() => setNotice('')}><X size={12} /></button></div>}
        {current && !current.matchesSnapshot && <div className="bp-note-warning" role="status">{t('review.stale')}<button onClick={refresh}>{t('action.refresh')}</button></div>}
        <div className="bp-note-wiki__toolbar"><div className="bp-note-wiki__tabs" role="tablist" aria-label={t('action.nodeDetail')}>
          {(['body', 'links'] as const).map(value => <button type="button" key={value} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - tabs.indexOf(event.currentTarget)
            tabs[next].focus(); tabs[next].click()
          }} onClick={() => { setTab(value); if (value === 'body' && unread) void mark() }}>{t(value === 'body' ? 'reader.body' : 'reader.related')}</button>)}
        </div><div className="bp-note-review-shortcut-host" ref={setShortcutHost} />
          {current && <details ref={actions} className="bp-note-wiki__actions" onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() }
          }} onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false }}><summary>{t('reader.sourceActions')}</summary><div>
            <button aria-pressed={raw} onClick={() => setRaw(value => !value)}>{t(raw ? 'reader.preview' : 'reader.fullSource')}</button>
            <button disabled={busy} onClick={() => void openFile(current.relPath, current.sha256).catch(error => setNotice(String(error)))}>{t('reader.openSource')}</button>
          </div></details>}
        </div>
        {!current && <div className="bp-note-loading" role="status" aria-label={t('attention.loadingBody')}><span /><span /><span /><span /></div>}
        {current && unread && <button className="bp-note-read-action" disabled={marking || busy} aria-busy={marking} onClick={() => void mark()}>{t(marking ? 'attention.markingRead' : 'attention.readBody')}</button>}
        {current && <div ref={body} hidden={tab !== 'body'} className="bp-note-wiki__body">
          <NoteReviewPanel view={review} rootPath={review?.context.workspacePath ?? ''} noteId={current.note.meta.id} kind={current.note.meta.kind} sourceHash={current.sha256} sourcePath={current.relPath} visit={visit} shortcutHost={shortcutHost} onReveal={() => setTab('body')} repairBusy={busy} onRepair={repair} onRun={runReview} onCancel={cancelReview} onClose={closeFindings} onRefresh={refresh} onLocate={(path, quote) => {
            if (path !== current.relPath) { void openFile(path).catch(error => setNotice(String(error))); return }
            const offset = current.raw.indexOf(quote)
            if (offset < 0) { setNotice(t('review.stale')); return }
            setRaw(true)
            requestAnimationFrame(() => {
              const element = body.current?.querySelector('pre.bp-note-source')
              if (!element?.firstChild) return
              const range = window.document.createRange(); range.setStart(element.firstChild, offset); range.setEnd(element.firstChild, offset + quote.length)
              const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
              revealNoteElement(element as HTMLElement)
            })
          }} />
          {raw ? <pre className="bp-note-source">{current.raw}</pre> : document && <NoteMarkdown source={document} link={renderLink(current)} />}
          <details className="bp-note-wiki__provenance"><summary>{t('reader.provenance')}</summary><div className="bp-note-wiki__identity"><code>{node.sourceUri}</code><span>{current.relPath}</span><span>sha256 {current.sha256.slice(0, 12)}</span></div>{fields}</details>
          {!!metadata?.codeRefs?.length && <div className="bp-note-wiki__group"><h4>{t('reader.codeRefs')}</h4>{metadata.codeRefs.map((ref, index) => <div key={index}><button disabled={ref.repoId !== snapshot?.repoId || !snapshot?.entries.some(entry => entry.relPath === ref.path && entry.sourceHash)} onClick={() => void openFile(ref.path).catch(error => setNotice(String(error)))}>{ref.path}</button><small>{ref.role}</small></div>)}</div>}
        </div>}
        {tab === 'links' && snapshot && node.sourceUri && <NoteRelations snapshot={snapshot} uri={node.sourceUri} rootPath={review?.context.workspacePath ?? ''} canNavigate={uri => Boolean(resolveCompositionNote(blueprint, node.id, uri))} onOpen={open} renderLink={renderLink} />}
        {children}
      </section>
    </div>
  </aside>
}
