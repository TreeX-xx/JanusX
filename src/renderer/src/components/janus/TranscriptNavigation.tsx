import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { ConversationNavigation, type NavigationInput } from '../ConversationNavigation'
import type { HistoryNavigation } from '../chat/VirtualHistory'

/** Topic histories are mounted, with one outer scroll owner (including folded branches). */
export function TranscriptNavigation({ scrollRef, following, onNavigate }: {
  scrollRef: RefObject<HTMLDivElement>; following: MutableRefObject<boolean>; onNavigate(): void
}) {
  const [items, setItems] = useState<NavigationInput[]>([])
  const navigationRef = useRef<HistoryNavigation | null>(null)
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    let readFrame = 0, jumpFrame = 0
    const read = () => {
      readFrame = 0
      const next = [...scroll.querySelectorAll<HTMLElement>('[data-user-message]')].map(message => ({
        id: message.dataset.userMessage!, turnId: message.closest<HTMLElement>('[data-history-key]')?.dataset.historyKey ?? message.dataset.userMessage!,
        type: 'userMessage' as const, text: message.dataset.navigationText ?? '',
      }))
      setItems(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const cancel = () => { cancelAnimationFrame(jumpFrame); jumpFrame = 0 }
    navigationRef.current = {
      cancel, isLocating: () => !!jumpFrame,
      locate(_key, id) {
        cancel()
        const message = scroll.querySelector<HTMLElement>(`[data-user-message="${CSS.escape(id)}"]`)
        if (!message) return
        following.current = false
        for (let parent = message.parentElement; parent && parent !== scroll; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open) parent.querySelector<HTMLElement>(':scope > summary')?.click()
        }
        jumpFrame = requestAnimationFrame(() => {
          jumpFrame = 0
          scroll.scrollTop += message.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12
        })
      },
    }
    read()
    const observer = new MutationObserver(() => { if (!readFrame) readFrame = requestAnimationFrame(read) })
    observer.observe(scroll, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-user-message', 'data-navigation-text'] })
    return () => { observer.disconnect(); cancelAnimationFrame(readFrame); cancel(); navigationRef.current = null }
  }, [scrollRef, following])
  return <ConversationNavigation items={items} scrollRef={scrollRef} navigationRef={navigationRef} following={following} onNavigate={onNavigate} />
}
