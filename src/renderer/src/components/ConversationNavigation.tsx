import { useEffect, useMemo, useRef, useState, type RefObject, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationItem } from '../../../shared/conversation-display'
import type { HistoryNavigation } from './chat/VirtualHistory'
import styles from './ConversationNavigation.module.css'

export type NavigationInput = Pick<ConversationItem, 'id' | 'turnId' | 'type' | 'text'>

// Reading/navigation ownership: .agents/notes/terminal/terminal-scrollback-navigation.md
export function ConversationNavigation({ items, scrollRef, navigationRef, following, onNavigate }: {
  items: NavigationInput[]; scrollRef: RefObject<HTMLDivElement>
  navigationRef: RefObject<HistoryNavigation>; onNavigate(): void
  following: MutableRefObject<boolean>
}) {
  const { t } = useTranslation('terminal')
  const inputs = useMemo(() => items.filter(item => item.type === 'userMessage'), [items])
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [current, setCurrent] = useState('')
  const [preview, setPreview] = useState<number | null>(null)
  const [railScroll, setRailScroll] = useState(0)
  const host = useRef<HTMLElement>(null)
  const anchor = useRef<{ id: string; offset: number } | null>(null)
  const rail = useRef<HTMLDivElement>(null)
  useEffect(() => { setPreview(null) }, [inputs.length])
  useEffect(() => {
    const list = rail.current
    const active = list?.querySelector<HTMLElement>('[aria-current]')
    if (!list || !active) return
    list.scrollTo({
      top: list.scrollTop + active.getBoundingClientRect().top - list.getBoundingClientRect().top
        - (list.clientHeight - active.offsetHeight) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }, [current, size.height, inputs.length])
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    let frame = 0
    const read = () => {
      frame = 0
      const top = scroll.getBoundingClientRect().top
      const line = top + 16
      const rows = [...scroll.querySelectorAll<HTMLElement>('[data-history-key]')]
      const row = rows.find(row => row.getBoundingClientRect().bottom > line && row.getBoundingClientRect().top <= line)
      const messages = [...scroll.querySelectorAll<HTMLElement>('[data-user-message]')].filter(message => message.getClientRects().length > 0)
      const above = messages.filter(message => message.getBoundingClientRect().top <= line)
        .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]
      const key = row?.dataset.historyKey
      const input = above && (!key || above.closest<HTMLElement>('[data-history-key]')?.dataset.historyKey === key)
        ? inputs.find(input => input.id === above.dataset.userMessage)
        : inputs.find(input => input.turnId === key) ?? inputs.find(input => input.id === above?.dataset.userMessage) ?? inputs[0]
      if (input) setCurrent(input.id)
      const first = messages.find(message => message.getBoundingClientRect().bottom > top)
      // Keep a visible message anchor; long answers use their measured turn row.
      const element = first && first.getBoundingClientRect().top < top + scroll.clientHeight ? first : row
      if (element) {
        const identity = element.dataset.userMessage
          ? inputs.find(input => input.id === element.dataset.userMessage)
          : inputs.find(input => input.turnId === key)
        const message = identity && messages.find(message => message.dataset.userMessage === identity.id)
        if (identity && message) anchor.current = { id: identity.id,
          offset: message.getBoundingClientRect().top - top }
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read) }
    const stop = () => navigationRef.current?.cancel()
    const keydown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop()
    }
    let previous = { width: scroll.clientWidth, height: scroll.clientHeight }
    const resize = new ResizeObserver(() => {
      const next = { width: scroll.clientWidth, height: scroll.clientHeight }
      setSize(next)
      if ((previous.width !== next.width || previous.height !== next.height) && anchor.current && !navigationRef.current?.isLocating()) {
        // At the bottom VirtualHistory continues following instead of pinning an old row.
        if (!following.current) {
          const saved = anchor.current
          const message = scroll.querySelector<HTMLElement>(`[data-user-message="${CSS.escape(saved.id)}"]`)
          // Restore synchronously from mounted geometry; never queue a navigation
          // request that can overtake the reader's next scroll.
          if (message) scroll.scrollTop += message.getBoundingClientRect().top - scroll.getBoundingClientRect().top - saved.offset
        }
      }
      previous = next
      schedule()
    })
    resize.observe(scroll)
    const mutations = new MutationObserver(schedule)
    mutations.observe(scroll, { childList: true, subtree: true })
    scroll.addEventListener('scroll', schedule)
    scroll.addEventListener('wheel', stop, { passive: true })
    scroll.addEventListener('touchstart', stop, { passive: true })
    scroll.addEventListener('pointerdown', stop)
    scroll.addEventListener('keydown', keydown)
    schedule()
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect()
      scroll.removeEventListener('scroll', schedule); scroll.removeEventListener('wheel', stop)
      scroll.removeEventListener('touchstart', stop); scroll.removeEventListener('pointerdown', stop)
      scroll.removeEventListener('keydown', keydown)
    }
  }, [inputs, scrollRef, navigationRef, following])
  if (!inputs.length || size.height < 1) return null
  const choose = (input: NavigationInput) => {
    navigationRef.current?.locate(input.turnId, input.id)
    onNavigate(); setCurrent(input.id); setPreview(null)
  }
  const label = (index: number) => t('conversation.inputNumber', { number: index + 1 })
  const input = preview === null ? undefined : inputs[preview]
  const popupHeight = Math.min(240, Math.max(32, size.height - 8))
  const railTop = rail.current?.offsetTop ?? 0
  const tickTop = preview === null ? size.height / 2 : railTop + preview * 18 - railScroll + 9
  const previewVisible = tickTop >= railTop && tickTop <= railTop + (rail.current?.clientHeight ?? 0)
  const top = Math.max(4, Math.min(tickTop - popupHeight / 2, size.height - popupHeight - 4))
  return <nav ref={host} className={styles.root} aria-label={t('conversation.inputNavigation')} data-input-navigation data-input-count={inputs.length}
    onMouseLeave={() => setPreview(null)} onKeyDown={event => {
      if (event.key === 'Escape') setPreview(null)
    }}>
    <div ref={rail} className={styles.rail} onScroll={event => setRailScroll(event.currentTarget.scrollTop)}>
      {inputs.map((input, index) => <button key={input.id} type="button" className={styles.tick}
        aria-label={label(index)} aria-current={input.id === current ? 'step' : undefined}
        onMouseEnter={() => setPreview(index)} onFocus={() => setPreview(index)} onBlur={() => setPreview(null)}
        onClick={() => choose(input)}><span /></button>)}
    </div>
    {input && previewVisible && <div className={styles.popup} style={{ top, maxHeight: popupHeight, width: Math.max(1, Math.min(300, size.width - 40)) }}
      role="tooltip" aria-label={t('conversation.inputNavigation')}>
      <span className={styles.number}>{label(preview!)}</span><div className={styles.preview}>{input.text || t('conversation.inputAttachment')}</div>
    </div>}
  </nav>
}
