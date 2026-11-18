import { Fragment, forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react'
import { ArrowLeft, Check, ChevronDown, Search, type LucideIcon } from 'lucide-react'
import { effortToneClass, effortVisualLevel } from './ReasoningEffort'
import styles from './AgentSessionPane.module.css'
import shared from './ComposerOptions.module.css'

/** Session owners provide choices and commits; both composers share their presentation. */
export interface ComposerChoice {
  id: string
  label: string
  description: string
  icon?: LucideIcon
  source?: string
  completion?: string
  provider?: { id: string; name: string }
  title?: string
  selected?: boolean
  disabled?: boolean
  run(): void
}

export const ComposerOptionTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ComposerOptionTrigger({ className = '', children, ...props }, ref) {
  return <button type="button" aria-haspopup="listbox" {...props} ref={ref} className={`${shared.control} ${className}`} data-composer-option-trigger="">{children}</button>
})

/** Arrow navigation is shared with slash-command completion in the native composer. */
export function composerOptionIndex(key: string, active: number, count: number, horizontal = false): number | undefined {
  if (horizontal && (key === 'Home' || key === 'End')) return key === 'Home' ? 0 : Math.max(0, count - 1)
  const step = key === 'ArrowDown' || horizontal && key === 'ArrowRight' ? 1 : key === 'ArrowUp' || horizontal && key === 'ArrowLeft' ? -1 : 0
  if (!step) return undefined
  return !count ? 0 : horizontal ? Math.max(0, Math.min(count - 1, active + step)) : (active + step + count) % count
}

export function ComposerOptions({ id, kind, title, options, active, onActiveChange, onKeyDown, search, searchRef, listRef, focusList = false, autoFocus = false, providers, back, hint, maxHeight, containerRef, selectionMenu, children, footer }: {
  id: string; kind: string; title: string; options: ComposerChoice[]; active: number
  onActiveChange(index: number): void
  onKeyDown: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>
  search?: { value: string; onChange(value: string): void; label: string; placeholder?: string }
  searchRef?: RefObject<HTMLInputElement>; listRef?: RefObject<HTMLDivElement>; focusList?: boolean; autoFocus?: boolean
  providers?: { label: string; allLabel: string; value: string; options: { id: string; name: string }[]; onChange(value: string): void }
  back?: { label: string; run(): void }; hint?: { label: string; title?: string }; maxHeight?: number
  containerRef?: RefObject<HTMLDivElement>; selectionMenu?: string; children?: ReactNode; footer?: ReactNode
}) {
  const fallbackSearch = useRef<HTMLInputElement>(null), input = searchRef ?? fallbackSearch
  const fallbackContainer = useRef<HTMLDivElement>(null), container = containerRef ?? fallbackContainer
  const [availableHeight, setAvailableHeight] = useState<number>()
  const horizontal = kind === 'effort', index = Math.max(0, Math.min(active, options.length - 1))
  const activeId = options.length ? `${id}-${index}` : undefined
  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' }) }, [activeId, options.length, kind])
  useEffect(() => { if (autoFocus) input.current?.focus() }, [autoFocus, input])
  useLayoutEffect(() => {
    const anchor = container.current?.closest('.janus-chat-input-wrapper'), viewport = anchor?.closest('.janus-chat-main')
    if (maxHeight !== undefined || !anchor || !viewport) return
    const measure = () => setAvailableHeight(Math.min(360, Math.max(0, anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12)))
    measure()
    const observer = new ResizeObserver(measure); observer.observe(anchor); observer.observe(viewport)
    return () => observer.disconnect()
  }, [maxHeight, container])
  return <div ref={container} className={shared.panel} data-composer-options="" data-panel={kind} style={{ maxHeight: maxHeight ?? availableHeight }}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      if (event.target instanceof HTMLSelectElement && event.key !== 'Escape') return
      onKeyDown(event)
    }}>
    <div className={styles.commandHeader}>{back && <button type="button" aria-label={back.label} onClick={back.run}><ArrowLeft size={15} /></button>}<span>{title}</span>{hint && <span title={hint.title}>{hint.label}</span>}</div>
    {search && <label className={styles.pickerSearch}><Search size={14} aria-hidden="true" /><input ref={input} value={search.value} onChange={event => search.onChange(event.target.value)}
      role="combobox" aria-label={search.label} aria-expanded aria-controls={id} aria-activedescendant={activeId} placeholder={search.placeholder ?? search.label} /></label>}
    {providers && <label className={styles.modelProviderFilter}><span>{providers.label}</span><select aria-label={providers.label} value={providers.value} onChange={event => { providers.onChange(event.target.value); input.current?.focus() }}>
      <option value="">{providers.allLabel}</option>{providers.options.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </select><ChevronDown size={12} aria-hidden="true" /></label>}
    <div className={horizontal ? styles.effortScale : styles.commandList} role="listbox" id={id} aria-label={title} ref={listRef} tabIndex={focusList ? 0 : undefined} data-selection-menu={selectionMenu}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-activedescendant={focusList ? activeId : undefined}>
      <div className={horizontal ? styles.effortTrack : undefined} style={horizontal ? { '--effort-count': Math.max(1, options.length), '--effort-active': index } as CSSProperties : undefined}>
        {horizontal && options.length > 0 && <span className={styles.effortIndicator} aria-hidden="true" />}
        {options.map((option, row) => <Fragment key={option.id}>
          {option.provider && option.provider.id !== options[row - 1]?.provider?.id && <div className={styles.modelGroupLabel} aria-hidden="true" data-provider={option.provider.id}>{option.provider.name}</div>}
          <button id={`${id}-${row}`} type="button" role="option" aria-selected={Boolean(option.selected)} aria-disabled={option.disabled || undefined}
            className={horizontal ? `${styles.effortOption} ${effortToneClass(option.id)}` : styles.commandOption} data-active={row === index} tabIndex={-1}
            onMouseEnter={() => onActiveChange(row)} onMouseDown={event => event.preventDefault()} onClick={() => { if (!option.disabled) option.run() }}
            title={horizontal ? undefined : option.title ?? option.description} aria-label={option.provider ? `${option.label} · ${option.provider.name}` : horizontal ? option.label : undefined}>
            {horizontal ? <><span className={styles.effortStep} aria-hidden="true"><span style={{ height: 6 + (effortVisualLevel(option.id) ?? 0) * 3 }} data-filled={row === index} /></span><span>{option.label}</span><i className={styles.effortSelected} aria-hidden="true" /></>
              : <>{option.icon && <option.icon size={16} aria-hidden="true" />}<span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.source && <em className={styles.commandKind}>{option.source}</em>}{kind === 'speed' && option.selected && <Check size={14} aria-hidden="true" />}</>}
          </button>
        </Fragment>)}
      </div>
    </div>
    {children}
    {footer && <div className={styles.pickerFootnote}>{footer}</div>}
  </div>
}
