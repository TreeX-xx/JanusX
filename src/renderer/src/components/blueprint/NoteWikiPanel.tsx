import { useEffect, useMemo, useRef, useState } from 'react'
import type { Components } from 'react-markdown'
import type { NoteReadSnapshot, NoteSourceRead } from '../../../../shared/notes'
import { noteWikiView } from '../../../../shared/note-wiki'
import { useEditorStore } from '@/stores/editor'
import { NoteMarkdown, revealNoteElement } from './NoteMarkdown'
import { NoteRelations } from './NoteRelations'
import { NoteReviewPanel } from './NoteReviewPanel'
import './note-wiki.css'
import './blueprint-disclosure.css'
import { useI18n } from '@/i18n/useI18n'
import { noteSourceKey, useNoteSourceStore } from '@/stores/note-source'
import { onBlueprintSourcesChanged } from '@/services/blueprint-sync'
import { sameCheckoutPath } from '@/features/blueprint/resolveNodeWorkspace'
import { useBlueprintReviewStore } from '@/stores/blueprint-review'
import type { NoteVisit } from '@/features/blueprint/useNoteNavigationMotion'
import type { NoteVersion } from '../../../../../plugins/blueprint/src/shared/blueprint-attention'

const statusLabel: Record<string, string> = { resolved: '已解析', missing: '缺失', unavailable: '未接入 / 不可读', ambiguous: '不明确', invalid: '无效' }
const errorText = (error: unknown): string => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
type Props = { onRetryNavigation?: () => void; visit?: NoteVisit; motionReady?: boolean; onSourceReady?: (version: NoteVersion | null, sequence?: number) => void; onReadBody?: (version: NoteVersion) => void | Promise<void>; snapshot: NoteReadSnapshot; rootPath: string; uri?: string; anchor?: string; compact?: boolean; canNavigate?: (uri: string) => boolean; onNavigate: (uri: string, anchor?: string) => void; onRefresh: () => void }

// Note: the engineering wiki reads the same Note, without a page copy — see .agents/notes/blueprint/documents/tasks/note-wiki-r3.md
export function NoteWikiPanel({ snapshot, rootPath, uri, anchor, compact = false, canNavigate, onNavigate, onRefresh, visit, motionReady, onSourceReady, onReadBody, onRetryNavigation }: Props) {
  const { t } = useI18n('blueprint')
  const unread = useBlueprintReviewStore(state => state.views[rootPath]?.updates?.entries.find(entry => uri?.endsWith('/' + entry.noteId))?.unread)
  const [tab, setTab] = useState<'body' | 'links'>('body')
  const [source, setSource] = useState<NoteSourceRead | null>(null)
  const [error, setError] = useState('')
  const delivered = useNoteSourceStore(state => uri ? state.sources[noteSourceKey(rootPath, uri)] : undefined)
  const lastDelivery = useRef({ rootPath, uri, delivered })
  const sourceRequest = useRef(0)
  const lastRead = useRef<{ rootPath: string; uri?: string; sourceHash?: string | null; reload: number; visitSequence?: number } | undefined>(undefined)
  const failedRead = useRef<{ uri?: string; sequence?: number } | null>(null)
  const [raw, setRaw] = useState(false)
  const [reload, setReload] = useState(0)
  const [notice, setNotice] = useState('')
  const [shortcutHost, setShortcutHost] = useState<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sourceActions = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const actions = sourceActions.current
      if (actions?.open && !actions.contains(event.target as Node)) actions.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  useEffect(() => { if (sourceActions.current) sourceActions.current.open = false }, [uri, tab])
  const visitSequence = visit?.sequence
  const scrolledVisit = useRef<number | undefined>(undefined)
  const jumpedAnchor = useRef('')
  const snap = snapshot
  const view = useMemo(() => noteWikiView(snap, uri ?? ''), [snap, uri])
  const sourceHash = snapshot.entries.find(entry => entry.uri === uri)?.sourceHash ?? view.entry?.sourceHash
  useEffect(() => {
    let active = true
    const request = ++sourceRequest.current
    const previous = lastRead.current
    lastRead.current = { rootPath, uri, sourceHash, reload, visitSequence }
    failedRead.current = null
    setSource(null); setError(''); setNotice(''); setRaw(false)
    if (uri) {
      const sameVisit = previous?.rootPath === rootPath && previous.uri === uri && previous.reload === reload && previous.visitSequence === visitSequence
      const current = useNoteSourceStore.getState().sources[noteSourceKey(rootPath, uri)]
      if (sameVisit && current?.sourceHash === sourceHash) { setSource(current); return }
      const changed = previous?.rootPath === rootPath && previous.uri === uri && (previous.sourceHash !== sourceHash || previous.reload !== reload)
      void useNoteSourceStore.getState().refresh(rootPath, uri, changed).then((result) => { if (active && request === sourceRequest.current) setSource(result) })
        .catch((reason: unknown) => { if (active && request === sourceRequest.current) { failedRead.current = { uri, sequence: visitSequence }; setError(errorText(reason)) } })
    }
    return () => { active = false }
  }, [rootPath, uri, sourceHash, reload, visitSequence])
  useEffect(() => {
    if (!uri) return
    let active = true
    const stop = onBlueprintSourcesChanged(event => {
      if (!sameCheckoutPath(event.root, rootPath) || event.error) return
      const request = ++sourceRequest.current
      void useNoteSourceStore.getState().refresh(rootPath, uri, true).catch(reason => {
        if (active && request === sourceRequest.current) { failedRead.current = { uri, sequence: visitSequence }; setError(errorText(reason)) }
      })
    })
    return () => { active = false; stop() }
  }, [rootPath, uri, visitSequence])
  useEffect(() => {
    const previous = lastDelivery.current
    lastDelivery.current = { rootPath, uri, delivered }
    if (previous.rootPath !== rootPath || previous.uri !== uri || previous.delivered === delivered) return
    if (!delivered || delivered.uri !== uri) return
    // A repair delivery supersedes an older in-flight body request.
    sourceRequest.current++; setSource(delivered); setError(''); failedRead.current = null
  }, [delivered, uri, rootPath])
  const jump = (value: string): void => {
    const target = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-note-anchor]') ?? [])].find((node) => node.dataset.noteAnchor === value)
    if (target) revealNoteElement(target)
    else setNotice('章节锚点不存在：' + value)
  }
  useEffect(() => {
    if (!anchor || !source || tab !== 'body' || raw || visitSequence) return
    const key = `${uri}:${anchor}`
    if (jumpedAnchor.current !== key) { jumpedAnchor.current = key; jump(anchor) }
  }, [anchor, source, tab, raw, uri, visitSequence])
  const open = (target: string, targetAnchor?: string): void => {
    if (!view.entries.has(target) && !canNavigate?.(target)) { setNotice('目标在当前 checkout 中不可唯一解析：' + target); return }
    setTab('body'); setRaw(false)
    if (target === uri) { if (targetAnchor) requestAnimationFrame(() => jump(targetAnchor)) }
    else onNavigate(target, targetAnchor)
  }
  const renderLink = (reading: NoteSourceRead): Components['a'] => ({ href, children }) => {
    if (!href) return <span>{children}</span>
    if (/^https?:\/\//i.test(href)) return <a className="bp-note-external-link" href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    const mention = snap.mentions.find(edge => edge.sourceUri === reading.uri && edge.destinations.includes(href))
    return <button type="button" className="bp-note-link" onClick={event => {
      if (href.startsWith('#')) {
        try {
          const anchor = decodeURIComponent(href.slice(1))
          const target = [...(event.currentTarget.closest('.bp-note-reader')?.querySelectorAll<HTMLElement>('[data-note-anchor]') ?? [])].find(node => node.dataset.noteAnchor === anchor)
          if (target) revealNoteElement(target); else setNotice(t('reader.anchorMissing', { anchor }))
        } catch { setNotice(t('reader.invalidAnchor')) }
        return
      }
      if (!reading.matchesSnapshot) { setNotice(t('reader.staleLinks')); return }
      if (mention?.targetUri && (mention.resolution.status === 'resolved' || canNavigate?.(mention.targetUri))) open(mention.targetUri, mention.anchor)
      else setNotice((statusLabel[mention?.resolution.status ?? 'unavailable'] ?? t('reader.unresolved')) + '：' + href)
    }}>{children}</button>
  }
  const openFile = async (path: string): Promise<void> => {
    if (/^(?:[/\\]|[A-Za-z]:)/.test(path) || path.split(/[/\\]/).includes('..') || /[*?]/.test(path)) { setNotice('此代码引用不是当前 checkout 内的单一文件'); return }
    try { await useEditorStore.getState().openFile(rootPath.replace(/[/\\]$/, '') + '/' + path, rootPath) }
    catch (reason) { setNotice(errorText(reason)) }
  }
  useEffect(() => {
    if (!visitSequence) return
    setTab('body'); setRaw(false)
  }, [visitSequence])
  useEffect(() => {
    if (!source || source.uri !== uri) return
    const frame = requestAnimationFrame(() => onSourceReady?.({ noteId: source.doc.id, hash: source.sourceHash, path: source.relPath }, visit?.sequence))
    return () => cancelAnimationFrame(frame)
  }, [source, uri, visit?.sequence, onSourceReady])
  useEffect(() => {
    if (error && failedRead.current && failedRead.current.uri === uri && failedRead.current.sequence === visitSequence) onSourceReady?.(null, visitSequence)
  }, [error, uri, visitSequence, onSourceReady])
  useEffect(() => {
    if (!motionReady || visit?.intent !== 'body' || !source || source.uri !== uri || scrolledVisit.current === visitSequence) return
    scrolledVisit.current = visitSequence
    const target = anchor ? [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-note-anchor]') ?? [])].find(node => node.dataset.noteAnchor === anchor) : bodyRef.current
    if (target) revealNoteElement(target)
  }, [motionReady, visitSequence, visit?.intent, uri, source, anchor])
  const current = source?.uri === uri ? source : null
  const [markedHash, setMarkedHash] = useState('')
  const [marking, setMarking] = useState(false)
  const markCurrent = async () => {
    if (!current || marking) return
    setMarking(true)
    try { await onReadBody?.({ noteId: current.doc.id, hash: current.sourceHash, path: current.relPath }); setMarkedHash(current.sourceHash) }
    catch (reason) { setNotice(errorText(reason)) }
    finally { setMarking(false) }
  }
  const metadata = current?.doc.metadata
  const identity = <div className="bp-note-wiki__identity"><code title={uri}>{uri}</code><span>{current?.relPath ?? view.entry?.relPath}</span><span>{current ? 'sha256 ' + current.sourceHash.slice(0, 12) : '读取原文…'}</span></div>
  const fields = current && <dl className="bp-note-wiki__metadata"><dt>类型</dt><dd>{current.doc.kind}</dd><dt>生命周期</dt><dd>{current.doc.lifecycle}</dd>{current.doc.moduleState && <><dt>模块状态</dt><dd>{current.doc.moduleState}</dd></>}{current.doc.updated && <><dt>维护时间</dt><dd>{current.doc.updated}</dd></>}{current.doc.kind === 'task' && <><dt>任务执行</dt><dd>{metadata?.execution?.state ?? '无执行记录'}</dd></>}</dl>
  return <section className={`bp-note-wiki${compact ? ' bp-note-wiki--compact' : ''}`} aria-label="工程 wiki">
    {(!compact || snap.coverage.status !== 'complete') && <div className="bp-note-wiki__scope">{!compact && <strong>工程 wiki</strong>}<span title={rootPath}>{snap.coverage.status === 'complete' ? '当前 checkout 完整扫描' : '扫描不完整 · 反链覆盖有限'}</span>{!compact && <small title={rootPath}>{rootPath}</small>}</div>}
    {uri && <>
      {!compact && identity}
      {error && <div role="alert" className="bp-note-warning">{error}<button type="button" onClick={() => { if (onRetryNavigation) onRetryNavigation(); else setReload(v => v + 1) }}>重试</button></div>}
      {current && !current.matchesSnapshot && <div role="status" className="bp-note-warning">源文已变化，当前显示新原文；关系仍来自旧快照。<button type="button" onClick={onRefresh}>刷新图谱</button></div>}
      {notice && <div role="status" className="bp-note-warning">{notice}<button type="button" onClick={() => setNotice('')}>关闭</button></div>}
      <div className="bp-note-wiki__toolbar"><div className="bp-note-wiki__tabs" role="tablist" aria-label="Note 详情">
        {(['body', 'links'] as const).map((value) => <button type="button" key={value} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value}
          onKeyDown={event => {
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
            if (!keys.includes(event.key)) return
            event.preventDefault()
            const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
            const index = tabs.indexOf(event.currentTarget), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            tabs[next].focus(); tabs[next].click()
          }} onClick={() => { setTab(value); if (value === 'body' && current) void markCurrent() }}>{t(value === 'body' ? 'reader.body' : 'reader.related')}</button>)}
      </div><div className="bp-note-review-shortcut-host" ref={setShortcutHost} />
      {current && <details ref={sourceActions} className="bp-note-wiki__actions" onKeyDown={event => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return
        event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }} onClick={event => {
        if (!(event.target as HTMLElement).closest('button')) return
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }}><summary>{t('reader.sourceActions')}</summary><div>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? '预览' : '完整源文'}</button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(current.raw).then(() => setNotice('已复制原文')).catch((reason) => setNotice(errorText(reason)))}>复制原文</button>
      </div></details>}</div>
      {!current && !error && <div className="bp-note-loading" role="status" aria-label={t('attention.loadingBody')}><span /><span /><span /><span /></div>}
      {current && (unread || visit && visit.intent !== 'body' && markedHash !== current.sourceHash) && <button type="button" className="bp-note-read-action" disabled={marking} aria-busy={marking} onClick={() => void markCurrent()}>{t(marking ? 'attention.markingRead' : 'attention.readBody')}</button>}
      {current && <div ref={bodyRef} hidden={tab !== 'body'} className="bp-note-wiki__body">
        <NoteReviewPanel shortcutHost={shortcutHost} onReveal={() => setTab('body')} key={rootPath + current.doc.id} rootPath={rootPath} noteId={current.doc.id} kind={current.doc.kind} sourceHash={current.sourceHash} sourcePath={current.relPath} visit={visit} motionReady={motionReady} onLocate={(path, quote) => {
          if (path !== current.relPath) { void openFile(path); return }
          const offset = current.raw.indexOf(quote)
          if (offset < 0) { setNotice('引用在当前原文中已不存在，请核对过时建议。'); return }
          setRaw(true)
          requestAnimationFrame(() => {
            const element = bodyRef.current?.querySelector<HTMLPreElement>('.bp-note-source')
            if (!element?.firstChild) return
            const range = document.createRange(); range.setStart(element.firstChild, offset); range.setEnd(element.firstChild, offset + quote.length)
            const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
            element.scrollIntoView({ block: 'center', behavior: 'smooth' })
          })
        }} />
        {!compact && fields}
        {raw ? <pre className="bp-note-source">{current.raw}</pre> : <NoteMarkdown key={current.uri + current.sourceHash} source={current} link={renderLink(current)} />}
        {compact && <details className="bp-note-wiki__provenance"><summary>来源与字段</summary><small>{rootPath}</small>{identity}{fields}</details>}
        {!!metadata?.codeRefs?.length && <div className="bp-note-wiki__group"><h4>代码落点</h4>{metadata.codeRefs.map((ref, index) => <div key={index}><button type="button" disabled={ref.repoId !== snap.repoId} onClick={() => void openFile(ref.path)}>{ref.path}</button><small>{ref.repoId === snap.repoId ? ref.role : '外部仓库 · ' + ref.repoId}</small></div>)}</div>}
      </div>}
      {tab === 'links' && <NoteRelations key={rootPath + uri} snapshot={snap} uri={uri} rootPath={rootPath} canNavigate={canNavigate} onOpen={open} renderLink={renderLink} />}
    </>}
  </section>
}
