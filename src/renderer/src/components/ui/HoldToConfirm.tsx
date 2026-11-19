import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createHoldToConfirmController, isHoldConfirmKey } from '@/lib/hold-to-confirm'
import { useI18n } from '@/i18n/useI18n'
import styles from './HoldToConfirm.module.css'

const DEFAULT_HOLD_DURATION_MS = 1000

interface HoldToConfirmProps {
  as?: 'button' | 'span'
  children: ReactNode
  className?: string
  disabled?: boolean
  label: string
  onConfirm: () => void
  style?: CSSProperties
  'data-tab-close'?: string
}

export function HoldToConfirm({
  as = 'button', children, className = '', disabled = false, label,
  onConfirm, style, ...attributes
}: HoldToConfirmProps) {
  const { t } = useI18n('common')
  const [holding, setHolding] = useState(false)
  const confirmRef = useRef(onConfirm)
  confirmRef.current = onConfirm

  const controllerRef = useRef<ReturnType<typeof createHoldToConfirmController> | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = createHoldToConfirmController({
      durationMs: DEFAULT_HOLD_DURATION_MS,
      onStart: () => setHolding(true),
      onCancel: () => setHolding(false),
      onConfirm: () => {
        setHolding(false)
        confirmRef.current()
      },
    })
  }

  useEffect(() => () => controllerRef.current?.dispose(), [])

  useEffect(() => {
    if (!holding) return
    const cancelHold = () => controllerRef.current?.cancel()
    if (disabled) {
      cancelHold()
      return
    }
    window.addEventListener('blur', cancelHold)
    return () => window.removeEventListener('blur', cancelHold)
  }, [disabled, holding])

  const start = () => {
    if (!disabled) controllerRef.current?.start()
  }
  const cancel = () => controllerRef.current?.cancel()
  const sharedProps = {
    ...attributes,
    'aria-label': t('common:holdToConfirm.aria', { label }),
    title: t('common:holdToConfirm.title', { label }),
    className: `${styles.control} ${holding ? styles.holding : ''} ${className}`,
    style: { ...style, '--hold-duration': `${DEFAULT_HOLD_DURATION_MS}ms` } as CSSProperties,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
    },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      // Mouse button chords only emit pointerdown for the first pressed button.
      // Let Chromium deliver mousedown/up for each mouse button transition.
      if (event.pointerType === 'mouse') return
      event.preventDefault()
      start()
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse') cancel()
    },
    onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      start()
    },
    onMouseUp: (event: React.MouseEvent<HTMLElement>) => {
      if (event.button === 0) cancel()
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onBlur: cancel,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!isHoldConfirmKey(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) start()
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!isHoldConfirmKey(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    },
  }

  if (as === 'span') {
    return (
      <span {...sharedProps} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}>
        <span aria-hidden="true">{children}</span>
      </span>
    )
  }

  return (
    <button {...sharedProps} type="button" disabled={disabled}>
      <span aria-hidden="true">{children}</span>
    </button>
  )
}
