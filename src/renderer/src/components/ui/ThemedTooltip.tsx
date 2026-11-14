import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './ThemedTooltip.module.css'

interface ThemedTooltipProps {
  /** 提示文本（替代原生 title，原生黑框由系统绘制，主题够不着） */
  label: ReactNode
  children: ReactNode
  /** 首选方位；空间不足自动翻转 */
  placement?: 'top' | 'bottom' | 'left'
  /** 悬浮多久后出现（毫秒，对齐原生 tooltip 节奏） */
  delayMs?: number
  disabled?: boolean
  /**
   * text：居中纯文本（默认，pre-wrap 保留换行）。
   * panel：左对齐结构化内容（标签/数值列），供用量卡片等同构浮层。
   */
  variant?: 'text' | 'panel'
  /** Allow compact usage indicators to pin their details with a click. */
  openOnClick?: boolean
}

interface TipGeometry {
  left: number
  top: number
}

/**
 * 主题化悬浮提示：一键配置机制——底座吃语义令牌，纸面走 :global 加法层。
 * 锚点 `display: contents`，不改变原布局；浮层挂 body portal，
 * Note: .agents/notes/workbench/right-dock.md — non-blocking tooltip behavior.
 * 按实测尺寸翻转、避让窗口边缘；按下/点击/滚动/resize/Esc 关闭。
 * `variant="panel"` 渲染左对齐的结构化内容（标签列+数值列）。
 */
export function ThemedTooltip({
  label,
  children,
  placement = 'top',
  delayMs = 350,
  disabled = false,
  variant = 'text',
  openOnClick = false,
}: ThemedTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const pointerFocusRef = useRef(false)
  const pinnedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [geometry, setGeometry] = useState<TipGeometry | null>(null)
  const [armed, setArmed] = useState(false)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const hide = useCallback(() => {
    pinnedRef.current = false
    clearTimer()
    setArmed(false)
    setAnchorRect(null)
    setGeometry(null)
  }, [])

  const show = (delay = delayMs) => {
    if (disabled || !label) return
    clearTimer()
    setArmed(true)
    timerRef.current = window.setTimeout(() => {
      // display: contents 自身无盒，量第一个子元素
      const target = anchorRef.current?.firstElementChild ?? anchorRef.current
      const rect = target?.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return
      setAnchorRect(rect)
    }, delay)
  }

  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!anchorRect || !tip) return
    const position = () => {
      const { width, height } = tip.getBoundingClientRect()
      const centeredLeft = anchorRect.left + (anchorRect.width - width) / 2
      let left = centeredLeft
      let top = anchorRect.top - height - 8
      if (placement === 'left') {
        left = anchorRect.left - width - 8
        if (left < 8 && anchorRect.right + width + 16 <= window.innerWidth) left = anchorRect.right + 8
        top = anchorRect.top + (anchorRect.height - height) / 2
      } else if (placement === 'bottom') {
        top = anchorRect.bottom + 8
        if (top + height > window.innerHeight - 8) top = anchorRect.top - height - 8
      } else if (top < 8) {
        top = anchorRect.bottom + 8
      }
      setGeometry({
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
      })
    }
    position()
    // Async previews can grow after mounting; keep the final content inside the viewport.
    const observer = new ResizeObserver(position)
    observer.observe(tip)
    return () => observer.disconnect()
  }, [anchorRect, placement, label])

  useEffect(() => {
    if (!armed) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (openOnClick) event.preventDefault()
        hide()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (openOnClick && event.target instanceof Node && anchorRef.current?.contains(event.target)) return
      hide()
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, openOnClick)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, openOnClick)
    }
  }, [armed, hide, openOnClick])

  useEffect(() => { if (disabled) hide() }, [disabled, hide])

  useEffect(() => clearTimer, [])

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.anchor}
        onMouseEnter={() => { if (!pinnedRef.current) show() }}
        onMouseLeave={() => { if (!pinnedRef.current) hide() }}
        onPointerDownCapture={() => { pointerFocusRef.current = true; if (!openOnClick) hide() }}
        onClickCapture={() => {
          if (!openOnClick || pinnedRef.current) hide()
          else { pinnedRef.current = true; show(0) }
        }}
        onFocus={(event) => {
          if (!pointerFocusRef.current && event.target.matches(':focus-visible')) show()
        }}
        onBlur={() => { pointerFocusRef.current = false; hide() }}
      >
        {children}
      </span>
      {anchorRect !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tipRef}
            className={variant === 'panel' ? styles.tipPanel : styles.tip}
            role="tooltip"
            style={{
              left: geometry?.left ?? 0,
              top: geometry?.top ?? 0,
              visibility: geometry ? 'visible' : 'hidden',
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  )
}

export default ThemedTooltip
