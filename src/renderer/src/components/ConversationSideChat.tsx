import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ChevronDown, CornerDownLeft, LoaderCircle, MessageSquareText, PanelRightClose, PanelRightOpen, Quote, Square, X } from 'lucide-react'
import type { ConversationSnapshot } from '../../../shared/conversation-display'
import { getTerminalDefault } from '../services/llm'
import { askSideChat, editSideChat, openSideChat, sameSideChatOwner, stopSideChat, useSideChats, type SideChatOwner, type SideChatSource } from '../stores/conversation-side-chat'
import type { ConversationInputHandle } from './ConversationInput'
import { MarkdownContent } from './chat/ChatContent'
import { recentSideChatSource, selectedSideChatSource } from './side-chat-selection'
import styles from './ConversationSideChat.module.css'

function Source({ source }: { source: SideChatSource }) {
  const { t } = useTranslation('terminal')
  return <div className={styles.quote}><details className={styles.source}>
    <summary><Quote size={13} aria-hidden="true" /><span>{source.path || t(`sideChat.sources.${source.kind}`)}</span><ChevronDown size={11} aria-hidden="true" /></summary>
    <pre>{source.text}</pre>
  </details><p className={styles.excerpt}>{source.text}</p></div>
}

export function ConversationSideChat({ owner, snapshot, visible, focused, header, main, input, canReturn, returnToMain }: {
  owner: SideChatOwner; snapshot: ConversationSnapshot; visible: boolean; focused: boolean; header: HTMLElement
  main: RefObject<HTMLDivElement>; input: RefObject<ConversationInputHandle>; canReturn: boolean; returnToMain: (text: string) => boolean
}) {
  const { t } = useTranslation('terminal')
  const id = useId()
  const chat = useSideChats(state => {
    const entry = state.chats[owner.terminalId]
    return entry && sameSideChatOwner(owner, entry.owner) ? entry : undefined
  })
  const open = !!chat?.open && visible
  const [candidate, setCandidate] = useState<ReturnType<typeof selectedSideChatSource>>()
  const [model, setModel] = useState<{ providerId: string; modelId: string } | null>()
  const [returnError, setReturnError] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const caret = useRef<{ start: number; end: number; value: string }>()
  const follow = useRef(true)
  const busy = !!chat?.abort
  const last = chat?.turns.at(-1)

  useEffect(() => {
    const host = main.current
    if (!visible || !host) { setCandidate(undefined); return }
    const select = () => setCandidate(selectedSideChatSource(host))
    let frame = 0
    const reposition = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(select)
    }
    document.addEventListener('selectionchange', select)
    host.addEventListener('pointerup', select)
    host.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', select)
      host.removeEventListener('pointerup', select)
      host.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [main, visible])
  useEffect(() => {
    if (!open) return
    let revision = 0
    const refresh = async () => {
      const version = ++revision
      setModel(undefined)
      const target = await getTerminalDefault('janus').catch(() => null)
      if (version === revision) setModel(target?.modelId ? { providerId: target.provider.id, modelId: target.modelId } : null)
    }
    void refresh()
    window.addEventListener('janus:llm-config-changed', refresh)
    return () => { revision++; window.removeEventListener('janus:llm-config-changed', refresh) }
  }, [open])
  useEffect(() => {
    if (!open || !focused) return
    const frame = requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open, focused])
  useLayoutEffect(() => {
    if (open && follow.current && history.current) history.current.scrollTop = history.current.scrollHeight
  }, [open, last?.answer, last?.status, last?.id])

  const show = (source?: SideChatSource) => {
    if (source?.kind === 'draft' && input.current) {
      caret.current = { start: input.current.selectionStart, end: input.current.selectionEnd, value: input.current.value }
    }
    openSideChat(owner, source ?? (!chat ? recentSideChatSource(snapshot.items, { user: t('conversation.historyUser'), agent: t('conversation.historyAgent') }) : undefined))
    setCandidate(undefined); setReturnError(false)
    requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }))
  }
  const close = (returned = false) => {
    editSideChat(owner, { open: false }); setReturnError(false); setCandidate(undefined)
    const saved = caret.current
    caret.current = undefined
    requestAnimationFrame(() => {
      if (input.current && (saved || returned)) {
        input.current.focus()
        if (returned) input.current.setSelectionRange(input.current.value.length, input.current.value.length)
        else if (saved?.value === input.current.value) input.current.setSelectionRange(saved.start, saved.end)
      } else launcher.current?.focus({ preventScroll: true })
    })
  }
  const send = (retry = false) => {
    if (!model || busy) return
    follow.current = true
    askSideChat(owner, model, retry)
    editor.current?.focus()
  }
  const bringBack = (button: HTMLButtonElement, answer: string) => {
    const selection = window.getSelection()
    const reply = button.closest('article')?.querySelector('[data-side-answer]')
    const selected = selection?.rangeCount && reply?.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.toString().trim() : ''
    if (returnToMain(selected || answer)) close(true)
    else setReturnError(true)
  }
  if (!visible) return null
  return <>
    {createPortal(<button type="button" className={styles.launcher} ref={launcher} aria-label={t('sideChat.title')} aria-expanded={open} aria-controls={open ? id : undefined}
      title={t('sideChat.title')} onMouseDown={e => e.preventDefault()} onClick={() => open ? close() : show(candidate?.source)}>
      <PanelRightOpen size={15} aria-hidden="true" /><span>{t('sideChat.title')}</span>
    </button>, header)}
    {candidate && <button type="button" className={styles.askSelection} style={{ left: candidate.left, top: candidate.top }}
      onMouseDown={e => e.preventDefault()} onClick={() => show(candidate.source)}><MessageSquareText size={14} />{t('sideChat.askSelection')}</button>}
    {open && chat && <aside id={id} className={styles.panel} data-side-chat-open="" aria-label={t('sideChat.title')}
      onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); close() } }}>
      <header className={styles.heading}><div><MessageSquareText size={16} aria-hidden="true" /><h2>{t('sideChat.title')}</h2></div>
        <button type="button" className={styles.icon} title={t('sideChat.close')} aria-label={t('sideChat.close')} onClick={() => close()}><PanelRightClose size={16} /></button>
      </header>
      <div ref={history} className={styles.history} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 54 }}>
        {!chat.turns.length && <div className={styles.empty}><MessageSquareText size={23} strokeWidth={1.5} aria-hidden="true" />
          <h3>{t('sideChat.empty')}</h3><p>{t('sideChat.hint')}</p></div>}
        {chat.turns.map(turn => <article key={turn.id} className={styles.turn}>
          <div className={styles.question}>{turn.source && <Source source={turn.source} />}<p>{turn.question}</p></div>
          <div className={styles.model}>{turn.status === 'streaming' ? <LoaderCircle className={styles.spin} size={12} /> : <MessageSquareText size={12} />}{turn.model}</div>
          {turn.answer && <div data-side-answer=""><MarkdownContent content={turn.answer} variant="conversation" streaming={turn.status === 'streaming'} /></div>}
          {turn.status === 'stopped' && <p className={styles.status} role="status">{t('sideChat.stopped')}</p>}
          {turn.status === 'failed' && <div role="alert" className={styles.error}>{turn.error || t('sideChat.noAnswer')}
            {turn === last && <button type="button" disabled={!model} onClick={() => send(true)}>{t('sideChat.retry')}</button>}</div>}
          {turn.answer && turn.status !== 'streaming' && <button type="button" className={styles.returnBtn} disabled={!canReturn}
            onMouseDown={e => e.preventDefault()} onClick={e => bringBack(e.currentTarget, turn.answer)}><CornerDownLeft size={13} />{t('sideChat.return')}</button>}
        </article>)}
      </div>
      <footer className={styles.footer}>
        {returnError && <p className={styles.error} role="alert">{t('sideChat.returnError')}</p>}
        {model === null && <div className={styles.setup} role="status">{t('sideChat.noModel')}
          <button type="button" onClick={() => window.dispatchEvent(new Event('janusx:open-llm-settings'))}>{t('sideChat.configure')}</button></div>}
        <form className={styles.composer} onSubmit={e => { e.preventDefault(); send() }}>
          {chat.source && <div className={styles.pendingSource}><Source source={chat.source} />
            <button className={styles.icon} type="button" title={t('sideChat.removeSource')} aria-label={t('sideChat.removeSource')} onClick={() => editSideChat(owner, { source: undefined })}><X size={13} /></button></div>}
          <textarea ref={editor} rows={2} maxLength={32000} aria-label={t('sideChat.input')} placeholder={t('sideChat.input')} value={chat.draft}
            onChange={e => editSideChat(owner, { draft: e.target.value })} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); send() }
            }} />
          <div className={styles.controls}><span title={model?.modelId}>{model?.modelId}</span>
            {busy ? <button type="button" className={styles.send} aria-label={t('sideChat.stop')} title={t('sideChat.stop')} onClick={() => stopSideChat(owner)}><Square size={12} fill="currentColor" /></button>
              : <button type="submit" className={styles.send} aria-label={t('sideChat.send')} title={t('sideChat.send')} disabled={!model || !chat.draft.trim()}><ArrowUp size={16} /></button>}</div>
        </form>
      </footer>
    </aside>}
  </>
}
