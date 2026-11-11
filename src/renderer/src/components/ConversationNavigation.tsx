import { useEffect, useMemo, useRef, useState, type RefObject, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationItem } from '../../../shared/conversation-display'
import type { HistoryNavigation } from './chat/VirtualHistory'
import styles from './ConversationNavigation.module.css'

// Reading/navigation ownership: .agents/notes/terminal/terminal-scrollback-navigation.md
export function ConversationNavigation({ items, scrollRef, navigationRef, following, onNavigate }: {
  items: ConversationItem[]; scrollRef: RefObject<HTMLDivElement>
  navigationRef: RefObject<HistoryNavigation>; onNavigate(): void
  following: MutableRefObject<boolean>
}) {
  const { t } = useTranslation('terminal')
  const inputs = useMemo(() => items.filter(item => item.type === 'userMessage'), [items])
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [current, setCurrent] = useState('')
  const [opened, setOpened] = useState<{ start: number; end: number } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const host = useRef<HTMLElement>(null)
  const anchor = useRef<{ id: string; offset: number } | null>(null)
  const capacity = Math.max(1, Math.floor((size.height - 24) / 18))
  const groups = useMemo(() => {
    const count = Math.min(inputs.length, capacity)
    return Array.from({ length: count }, (_, index) => ({
      start: Math.floor(index * inputs.length / count), end: Math.floor((index + 1) * inputs.length / count),
    }))
  }, [inputs.length, capacity])
  useEffect(() => { setOpened(null); setPreview(null) }, [inputs.length])
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
      const messages = [...scroll.querySelectorAll<HTMLElement>('[data-user-message]')]
      const above = messages.filter(message => message.getBoundingClientRect().top <= line)
        .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]
      const key = row?.dataset.historyKey
      const input = above && (!key || above.closest<HTMLElement>('[data-history-key]')?.dataset.historyKey === key)
        ? inputs.find(input => input.id === above.dataset.userMessage)
        : inputs.find(input => input.turnId === key) ?? inputs[0]
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
  useEffect(() => {
    if (opened === null) return
    host.current?.querySelector<HTMLButtonElement>('[role=dialog] button')?.focus()
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpened(null) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [opened])
  if (!inputs.length || size.height < 1) return null
  const selected = opened ? groups.findIndex(group => group.start <= opened.start && group.end > opened.start) : preview
  const group = opened ?? (selected === null ? undefined : groups[selected])
  const currentIndex = inputs.findIndex(input => input.id === current)
  const choose = (input: ConversationItem) => {
    navigationRef.current?.locate(input.turnId, input.id)
    host.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus({ preventScroll: true })
    onNavigate(); setCurrent(input.id); setOpened(null); setPreview(null)
  }
  const label = (index: number) => t('conversation.inputNumber', { number: index + 1 })
  const popupHeight = Math.min(240, Math.max(32, size.height - 8))
  const top = selected === null ? 0 : Math.min(Math.max(4, (selected + .5) * size.height / groups.length - popupHeight / 2), size.height - popupHeight - 4)
  return <nav ref={host} className={styles.root} aria-label={t('conversation.inputNavigation')} data-input-navigation data-input-count={inputs.length}
    onMouseLeave={() => setPreview(null)} onKeyDown={event => {
      if (event.key === 'Escape') {
        host.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus({ preventScroll: true })
        setOpened(null); setPreview(null)
      }
    }}>
    <div className={styles.rail}>
      {groups.map((group, index) => <button key={index} type="button" className={styles.tick}
        aria-label={label(group.start)} aria-current={currentIndex >= group.start && currentIndex < group.end ? 'step' : undefined}
        aria-expanded={!!opened && selected === index} aria-haspopup={group.end - group.start > 1 ? 'dialog' : undefined}
        onMouseEnter={() => setPreview(index)} onFocus={() => setPreview(index)} onBlur={() => setPreview(null)}
        onClick={() => { if (group.end - group.start === 1) choose(inputs[group.start]); else { setOpened(group); setPreview(null) } }}><span /></button>)}
    </div>
    {group && <div className={styles.popup} style={{ top, maxHeight: popupHeight, width: Math.max(1, Math.min(300, size.width - 40)) }}
      role={opened === null ? 'tooltip' : 'dialog'} aria-label={t('conversation.inputNavigation')}>
      {opened === null ? <><span className={styles.number}>{label(group.start)}{group.end - group.start > 1 ? ` – ${group.end}` : ''}</span><div className={styles.preview}>{inputs[group.start].text || t('conversation.inputAttachment')}</div></>
        : inputs.slice(group.start, group.end).map((input, offset) => <button type="button" key={input.id} className={styles.entry}
          aria-label={label(group.start + offset)} aria-current={input.id === current ? 'step' : undefined} onClick={() => choose(input)}>
          <span className={styles.number}>{label(group.start + offset)}</span><span className={styles.preview}>{input.text || t('conversation.inputAttachment')}</span>
        </button>)}
    </div>}
  </nav>
}
