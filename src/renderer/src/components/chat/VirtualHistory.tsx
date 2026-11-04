import { createContext, memo, useCallback, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject, type MutableRefObject } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'

// Shared viewport/disclosure lifetime: .agents/notes/workbench/long-session-performance.md
const DisclosureState = createContext<Map<string, boolean> | null>(null)
export function useHistoryDisclosure(key: string, fallback: boolean) {
  const cache = useContext(DisclosureState)
  const [explicit, setExplicit] = useState<boolean | undefined>(() => cache?.get(key))
  return [explicit ?? fallback, (value: boolean | ((previous: boolean) => boolean)) => {
    const open = typeof value === 'function' ? value(explicit ?? fallback) : value
    cache?.set(key, open)
    setExplicit(open)
  }] as const
}

export function LazyDetails({ stateKey, summary, children, ...props }: {
  stateKey: string; summary: ReactNode; children: () => ReactNode
} & Omit<HTMLAttributes<HTMLDetailsElement>, 'children'>) {
  const [open, setOpen] = useHistoryDisclosure(`details:${stateKey}`, false)
  return <details {...props} open={open} onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
  }}>{summary}{open ? children() : null}</details>
}

function HistoryRowBody<T>({ cache, item, index, renderItem }: { cache: Map<string, boolean>; item: T; index: number; renderItem(item: T, index: number): ReactNode }) {
  return <DisclosureState.Provider value={cache}>{renderItem(item, index)}</DisclosureState.Provider>
}
const HistoryRow = memo(HistoryRowBody) as typeof HistoryRowBody

/** Latest item stays in normal flow. Only the historical viewport is virtualized. */
export function VirtualHistory<T>({ items, itemKey, renderItem, scrollRef, following, pinnedKey, active = true, rowStyle, gap = 0 }: {
  items: readonly T[]; itemKey(item: T): string; renderItem(item: T, index: number): ReactNode
  scrollRef: RefObject<HTMLDivElement>; following: MutableRefObject<boolean>; pinnedKey?: string; active?: boolean
  rowStyle?: CSSProperties; gap?: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const states = useRef(new Map<string, Map<string, boolean>>())
  const [margin, setMargin] = useState(0)
  const count = Math.max(0, items.length - 1)
  const virtual = items.length > 20
  const getKey = useCallback((index: number) => itemKey(items[index]), [items, itemKey])
  const pinned = pinnedKey ? items.findIndex(item => itemKey(item) === pinnedKey) : -1
  const rangeExtractor = useCallback((range: Range) => {
    const indices = defaultRangeExtractor(range)
    if (pinned >= 0 && pinned < count && !indices.includes(pinned)) indices.push(pinned)
    return indices.sort((a, b) => a - b)
  }, [pinned, count])
  const list = useVirtualizer({
    count: virtual ? count : 0, getScrollElement: () => scrollRef.current,
    estimateSize: () => 360, getItemKey: getKey, overscan: 2, scrollMargin: margin,
    anchorTo: 'end', followOnAppend: false, rangeExtractor,
  })
  list.shouldAdjustScrollPositionOnItemSizeChange = item => !following.current && (
    // Initial estimates above the viewport need compensation; growth inside the
    // currently read row must not move the reader. RO remeasures visible widths.
    !list.itemSizeCache.has(item.key) ? item.start < (list.scrollOffset ?? 0) : item.end <= (list.scrollOffset ?? 0)
  )
  useLayoutEffect(() => {
    const root = host.current, scroll = scrollRef.current
    if (!root || !scroll || !active) return
    const measure = () => {
      setMargin(root.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop)
      if (following.current) scroll.scrollTop = scroll.scrollHeight
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [active, following, list, scrollRef])
  useLayoutEffect(() => {
    const keys = new Set(items.map(itemKey))
    for (const key of states.current.keys()) if (!keys.has(key)) states.current.delete(key)
    if (active && following.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [items, itemKey, active, following, scrollRef])
  const render = (index: number) => {
    const item = items[index], key = itemKey(item)
    let cache = states.current.get(key)
    if (!cache) { cache = new Map(); states.current.set(key, cache) }
    return <HistoryRow key={key} cache={cache} item={item} index={index} renderItem={renderItem} />
  }
  const rows = list.getVirtualItems()
  return <div ref={host} data-virtual-history={virtual || undefined} style={{ overflowAnchor: 'none', flexShrink: 0, minWidth: 0 }}>
    {virtual ? <div style={{ height: list.getTotalSize(), position: 'relative' }}>
      {rows.map(({ index, start }) => {
        return <div key={getKey(index)} data-index={index} data-history-key={getKey(index)} ref={list.measureElement}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', display: 'flow-root', ...rowStyle, paddingBottom: gap, transform: `translateY(${start - margin}px)` }}>{render(index)}</div>
      })}
    </div> : items.slice(0, count).map((_, index) => <div key={getKey(index)} data-history-key={getKey(index)} style={{ display: 'flow-root', ...rowStyle, paddingBottom: gap }}>{render(index)}</div>)}
    {items.length > 0 && <div data-history-key={getKey(count)} data-live-tail style={{ display: 'flow-root', ...rowStyle }}>{render(count)}</div>}
  </div>
}
