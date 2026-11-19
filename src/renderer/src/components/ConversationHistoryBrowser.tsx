import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, LoaderCircle } from 'lucide-react'
import type { ConversationHistoryItem, ConversationHistoryPage, ConversationHistoryRequest, ConversationHistoryText } from '../../../shared/conversation-history'
import { VirtualHistory } from './chat/VirtualHistory'
import { MarkdownContent } from './chat/ChatContent'
import { ConversationPrompt } from './ConversationPrompt'
import { ConversationToolCall } from './chat/ConversationToolCall'
import { ConversationPlanPanel } from './ConversationPlanPanel'
import { ConversationFileChanges } from './ConversationFileChanges'
import { conversationFileChanges } from '../../../shared/conversation-file-changes'
import turnStyles from './AgentSessionPane.module.css'
import styles from './ConversationHistoryBrowser.module.css'

const WINDOW_PAGES = 3
type Page = { value: ConversationHistoryPage; cursor?: string }
export interface ConversationHistoryBookmark {
  cursor?: string; anchorId?: string; offset?: number
  item?: { id: string; turnId: string }; textOffset?: number; textVersion?: string
}

/** Only three native pages and one text chunk survive. Unmounting releases them. */
export const ConversationHistoryBrowser = memo(function ConversationHistoryBrowser({ terminalId, threadId, workspacePath, bookmark, openFile, close }: {
  terminalId: string; threadId: string; workspacePath?: string; bookmark: ConversationHistoryBookmark; openFile(path: string): Promise<void>; close(): void
}) {
  const { t } = useTranslation('terminal')
  const [pages, setPages] = useState<Page[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [selected, setSelected] = useState(bookmark.item), [body, setBody] = useState<ConversationHistoryText>()
  const scroll = useRef<HTMLDivElement>(null), following = useRef(false), locked = useRef(false), generation = useRef(0)
  const anchor = useRef<{ id: string; top: number }>(), [pinned, setPinned] = useState<string>()
  const retry = useRef<() => void>(() => {})
  const items = useMemo(() => {
    const seen = new Set<string>()
    return pages.flatMap(page => page.value.items).filter(item => !seen.has(item.id) && !!seen.add(item.id))
  }, [pages])
  const changesByTurn = useMemo(() => conversationFileChanges(items), [items])
  const plansByTurn = useMemo(() => new Map(pages.flatMap(page => page.value.plans ?? []).map(plan => [plan.turnId, plan])), [pages])
  const documentsByTurn = useMemo(() => new Map(items.filter(item => item.type === 'plan' && item.text).map(item => [item.turnId, item])), [items])
  const lastItemByTurn = useMemo(() => new Map(items.map(item => [item.turnId, item.id])), [items])
  const request = useCallback(async (value: ConversationHistoryRequest) => {
    const api = window.electron.terminal.conversationHistory
    if (!api) throw new Error(t('conversation.historyUnavailable'))
    return api(terminalId, value)
  }, [terminalId, t])
  const capture = () => {
    const host = scroll.current
    if (!host) return undefined
    const top = host.getBoundingClientRect().top
    const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-history-item]'))
    const bottom = host.getBoundingClientRect().bottom
    const node = nodes.find(row => row.getBoundingClientRect().bottom > top + 1 && row.getBoundingClientRect().top < bottom)
    return node ? { id: node.dataset.historyItem!, top: node.getBoundingClientRect().top - top } : undefined
  }
  const load = useCallback(async (direction: 'older' | 'newer' | 'initial') => {
    if (locked.current) return
    const cursor = direction === 'older' ? pages[0]?.value.olderCursor : direction === 'newer' ? pages.at(-1)?.value.newerCursor : bookmark.cursor
    if (direction !== 'initial' && !cursor) return
    locked.current = true; setLoading(true); setError('')
    const epoch = generation.current
    retry.current = () => { void load(direction) }
    try {
      const result = await request({ type: 'page', threadId, ...(cursor ? { cursor } : { beforeItemId: bookmark.anchorId }) })
      // Let the virtual viewport commit a scroll before capturing its visible row.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (epoch !== generation.current) return
      if (result.type !== 'page' || result.threadId !== threadId) throw new Error(t('conversation.historyUnavailable'))
      retry.current = () => {}
      const current = direction === 'initial' ? undefined : capture()
      anchor.current = current ?? (bookmark.anchorId ? { id: bookmark.anchorId, top: bookmark.offset ?? 12 } : undefined)
      setPinned(anchor.current?.id)
      const page = { value: result, cursor: cursor ?? undefined }
      setPages(previous => direction === 'initial' ? [page]
        : direction === 'older' ? [page, ...previous].slice(0, WINDOW_PAGES) : [...previous, page].slice(-WINDOW_PAGES))
    } catch (cause) { if (epoch === generation.current) setError(String(cause)) }
    finally { if (epoch === generation.current) { locked.current = false; setLoading(false) } }
  }, [pages, bookmark, request, threadId, t])
  const loadText = useCallback(async (item: { id: string; turnId: string }, offset = 0, version?: string) => {
    if (locked.current) return
    locked.current = true; setLoading(true); setError(''); setSelected({ id: item.id, turnId: item.turnId })
    const epoch = generation.current
    retry.current = () => { void loadText(item) }
    try {
      const result = await request({ type: 'text', threadId, itemId: item.id, turnId: item.turnId, offset, ...(version ? { version } : {}) })
      if (epoch !== generation.current) return
      if (result.type !== 'text' || result.threadId !== threadId || result.itemId !== item.id) throw new Error(t('conversation.historyUnavailable'))
      retry.current = () => {}
      bookmark.item = { id: item.id, turnId: item.turnId }; bookmark.textOffset = result.offset; bookmark.textVersion = result.version
      setBody(result); if (scroll.current) scroll.current.scrollTop = 0
    } catch (cause) { if (epoch === generation.current) setError(String(cause)) }
    finally { if (epoch === generation.current) { locked.current = false; setLoading(false) } }
  }, [request, threadId, t, bookmark])
  useEffect(() => {
    const epoch = ++generation.current
    locked.current = false
    if (bookmark.item) void loadText(bookmark.item, bookmark.textOffset, bookmark.textVersion)
    else void load('initial')
    return () => { generation.current = epoch + 1; locked.current = false }
    // Bookmark is an entry position, not a reason to restart an active reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, threadId])
  useLayoutEffect(() => {
    const saved = anchor.current, host = scroll.current
    if (!saved || !host || selected) return
    let frame = 0, attempts = 0
    const restore = () => {
      const node = host.querySelector<HTMLElement>(`[data-history-item="${CSS.escape(saved.id)}"]`)
      if (node) host.scrollTop += node.getBoundingClientRect().top - host.getBoundingClientRect().top - saved.top
      if (++attempts < 3) frame = requestAnimationFrame(restore)
      else { anchor.current = undefined; setPinned(undefined) }
    }
    restore()
    return () => cancelAnimationFrame(frame)
  }, [items, selected])
  const remember = () => {
    if (selected || anchor.current) return
    const current = capture()
    if (!current) return
    const page = pages.find(row => row.value.items.some(item => item.id === current.id))
    bookmark.cursor = page?.cursor; bookmark.anchorId = current.id; bookmark.offset = current.top
  }
  const older = pages[0]?.value.olderCursor, newer = pages.at(-1)?.value.newerCursor
  const back = () => {
    if (!bookmark.anchorId && selected) { bookmark.anchorId = selected.id; bookmark.offset = 12 }
    bookmark.item = undefined; bookmark.textOffset = undefined; bookmark.textVersion = undefined
    anchor.current = bookmark.anchorId ? { id: bookmark.anchorId, top: bookmark.offset ?? 12 } : undefined
    setPinned(anchor.current?.id); setSelected(undefined); setBody(undefined); setError('')
    if (!pages.length) void load('initial')
  }
  const readMore = (item: ConversationHistoryItem) => item.truncated && <button type="button" className={styles.readMore}
    onClick={() => { remember(); void loadText(item) }} disabled={loading}>{t('conversation.readFullContent')}</button>
  const render = (item: ConversationHistoryItem) => {
    const turnId = item.turnId
    const last = lastItemByTurn.get(turnId) === item.id
    const plan = last ? plansByTurn.get(turnId) : undefined
    const document = last ? documentsByTurn.get(turnId) : undefined
    const changes = last ? changesByTurn.get(turnId) : undefined
    const partial = (!!older && items[0]?.turnId === turnId) || (!!newer && items.at(-1)?.turnId === turnId)
    return <article className={styles.message} data-history-item={item.id} data-side-item={item.id} data-side-turn={turnId}
      data-side-source={item.type === 'userMessage' ? 'message' : item.type === 'agentMessage' ? 'reply' : undefined} hidden={item.type === 'plan' && !plan && !document && !changes}>
      {item.type !== 'plan' && <>
        <span className={styles.label}>{t(item.type === 'userMessage' ? 'conversation.historyUser' : item.type === 'agentMessage' ? 'conversation.historyAgent' : 'conversation.historyActivity')}</span>
        {item.type === 'userMessage' ? <div className={styles.user}><ConversationPrompt text={item.text} /></div>
          : item.type === 'agentMessage' || item.type === 'reasoning'
            ? <MarkdownContent content={item.text} variant="conversation" workspacePath={workspacePath} />
            : <ConversationToolCall item={item} openFile={openFile} />}
        {readMore(item)}
      </>}
      {(plan || document || changes) && <div className={turnStyles.turnAttachments}>
        {(plan || document) && <ConversationPlanPanel turnId={turnId} plan={plan} document={document?.text} connection="ready"
          historical workspacePath={workspacePath} readMore={document && readMore(document)} />}
        {changes && <ConversationFileChanges turnId={turnId} files={changes.files} incomplete={changes.incomplete || partial} openFile={openFile} />}
      </div>}
    </article>
  }
  return <section className={styles.browser} data-conversation-history-browser="" data-page-count={pages.length}
    aria-label={t('conversation.fullHistory')} aria-busy={loading || Boolean(pinned) || undefined}>
    <header className={styles.header}><div>{selected && <button type="button" disabled={loading} onClick={back}><ArrowLeft size={14} />{t('conversation.historyBack')}</button>}<strong>{t(selected ? 'conversation.fullContent' : 'conversation.fullHistory')}</strong>{loading && <LoaderCircle size={14} aria-label={t('conversation.historyLoading')} />}</div>
      <button type="button" onClick={close}><ArrowDown size={14} />{t('conversation.historyLatest')}</button></header>
    {error && <div className={styles.error} role="alert">{error}<button type="button" disabled={loading} onClick={() => retry.current()}>{t('conversation.historyRetry')}</button></div>}
    <div className={styles.scroll} ref={scroll} role="region" aria-label={t('conversation.fullHistory')} tabIndex={0} onScroll={() => {
      remember()
      const host = scroll.current
      if (!host || loading || error || selected || anchor.current) return
      if (host.scrollTop < 100 && older) void load('older')
      else if (host.scrollHeight - host.scrollTop - host.clientHeight < 100 && newer) void load('newer')
    }}><div className={styles.content}>
      {selected ? body && <pre className={styles.text} data-history-text-offset={body.offset} data-side-item={selected.id} data-side-turn={selected.turnId} data-side-source="message">{body.text}</pre> : <>
        <div className={styles.boundary}>{older ? <button type="button" disabled={loading} onClick={() => void load('older')}>{t('conversation.loadEarlier')}</button> : pages.length > 0 && t('conversation.historyBeginning')}</div>
        <VirtualHistory items={items} itemKey={item => item.id} renderItem={render} scrollRef={scroll} following={following} pinnedKey={pinned} gap={8} />
        <div className={styles.boundary}>{newer && <button type="button" disabled={loading} onClick={() => void load('newer')}>{t('conversation.loadNewer')}</button>}</div>
      </>}
    </div></div>
    {selected && body && <nav className={styles.pagination} aria-label={t('conversation.fullContent')}><button type="button" disabled={loading || body.previousOffset === null} onClick={() => void loadText(selected, body.previousOffset!, body.version)}>{t('conversation.previousContent')}</button>
      <span>{t('conversation.contentRange', { start: body.total ? body.offset + 1 : 0, end: body.offset + body.text.length, total: body.total })}</span>
      <button type="button" disabled={loading || body.nextOffset === null} onClick={() => void loadText(selected, body.nextOffset!, body.version)}>{t('conversation.nextContent')}</button></nav>}
  </section>
})
