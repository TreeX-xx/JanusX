import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useId } from 'react'
import { t } from './i18n'
import styles from './Select.module.css'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  depth?: number
  /** 选项前的图标节点（如终端 preset 图标）。省略即纯文字选项。 */
  icon?: ReactNode
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  prefix?: ReactNode
  disabled?: boolean
  /** 透传到触发按钮的 className，便于覆盖尺寸/布局 */
  className?: string
  /** 浮层额外 className */
  dropdownClassName?: string
  /** 透传到触发按钮的内联样式，便于控制尺寸 */
  style?: CSSProperties
  /** 触发按钮的无障碍名称 */
  ariaLabel?: string
  role?: 'combobox'
  /** 指定浮层挂载容器，避免 Modal 内部下拉被外层遮罩覆盖 */
  getPortalContainer?: () => HTMLElement | null
}

interface DropdownPos {
  top: number
  left: number
  width: number
  maxHeight: number
  openUp: boolean
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  prefix,
  disabled,
  className,
  dropdownClassName,
  style,
  ariaLabel,
  role,
  getPortalContainer
}: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<DropdownPos | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = useId()
  const openList = () => {
    const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled))
    setOpen(true)
  }

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[data-active="true"]')
    if (!open || !pos || !list || !active) return
    const above = active.offsetTop - list.scrollTop
    const below = above + active.offsetHeight - list.clientHeight
    if (above < 0) list.scrollTop += above
    else if (below > 0) list.scrollTop += below
  }, [activeIndex, open, pos])

  const selected = options.find((o) => o.value === value)
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const edge = 8
    const gap = 4
    const desiredHeight = Math.min(options.length * 28 + 16, 240)
    const spaceBelow = window.innerHeight - rect.bottom - edge - gap
    const spaceAbove = rect.top - edge - gap
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow
    const maxHeight = Math.max(32, Math.min(desiredHeight, openUp ? spaceAbove : spaceBelow))
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - edge * 2)
    setPos({
      top: openUp ? rect.top - gap - maxHeight : rect.bottom + gap,
      left: Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)),
      width,
      maxHeight,
      openUp
    })
  }, [options.length])

  useIsomorphicLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const reposition = (event: Event) => {
      if (event.type === 'scroll' && listRef.current?.contains(event.target as Node)) return
      updatePosition()
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, updatePosition])

  // Esc 关闭 + 浮层外点击关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (listRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onPointer, true)
    }
  }, [open])

  const handleSelect = (o: SelectOption) => {
    if (o.disabled) return
    onChange(o.value)
    setOpen(false)
  }

  const portalContainer = typeof document === 'undefined'
    ? null
    : getPortalContainer?.() ?? document.body

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${className ?? ''} ${
          open ? styles.triggerOpen : ''
        }`}
        style={style}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        role={role}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={role === 'combobox' && open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => { if (open) setOpen(false); else openList() }}
        onKeyDown={event => {
          if (event.key === 'Tab') { setOpen(false); return }
          if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); event.stopPropagation()
            if (options[activeIndex]) handleSelect(options[activeIndex])
            return
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault(); event.stopPropagation()
          if (!open) { openList(); return }
          const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)
          if (!enabled.length) return
          const index = enabled.indexOf(activeIndex)
          setActiveIndex(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled[enabled.length - 1]
            : enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length])
        }}
      >
        {prefix && <span className={styles.triggerPrefix}>{prefix}</span>}
        <span className={styles.triggerLabel}>
          {selected ? selected.label : <span className={styles.placeholder}>{placeholder ?? ''}</span>}
        </span>
        <svg
          className={styles.arrow}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open &&
        pos &&
        portalContainer &&
        createPortal(
          <div
            ref={listRef}
            className={`${styles.dropdown} ${dropdownClassName ?? ''} ${
              pos.openUp ? styles.dropdownUp : ''
            }`}
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              animationDuration: '0.12s'
            }}
            data-select-dropdown=""
            id={listId}
            aria-label={ariaLabel}
            role="listbox"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {options.length === 0 && (
              <div className={styles.empty}>{t('暂无选项')}</div>
            )}
            {options.map((o, index) => {
              const isSel = o.value === value
              return (
                <div
                  key={o.value}
                  role="option"
                  id={`${listId}-${index}`}
                  data-active={index === activeIndex || undefined}
                  aria-selected={isSel}
                  aria-disabled={o.disabled || undefined}
                  className={`${styles.option} ${
                    isSel ? styles.optionSelected : ''
                  } ${o.disabled ? styles.optionDisabled : ''}`}
                  style={o.depth ? { paddingLeft: `${10 + o.depth * 14}px` } : undefined}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => { if (!o.disabled) setActiveIndex(index) }}
                  onClick={() => handleSelect(o)}
                >
                  {o.icon && <span className={styles.optionIcon}>{o.icon}</span>}
                  {o.label}
                </div>
              )
            })}
          </div>,
          portalContainer
        )}
    </>
  )
}

export default Select
