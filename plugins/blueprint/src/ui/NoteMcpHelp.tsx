import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from './SettingsIcons'
import { settingsText as t } from './settings-text'
import styles from './BlueprintSettingsPanel.module.css'

export function NoteMcpHelp() {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const clearTimer = useCallback(() => { clearTimeout(timer.current) }, [])
  const hide = useCallback(() => { clearTimer(); setOpen(false) }, [clearTimer])
  const show = () => { clearTimer(); setOpen(true) }
  const leave = () => {
    clearTimer()
    timer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current && !trigger.current?.matches(':hover') && !tip.current?.matches(':hover')) setOpen(false)
    }, 120)
  }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !tip.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const box = tip.current.getBoundingClientRect()
    const below = window.innerHeight - anchor.bottom - 8
    const top = below >= box.height || below >= anchor.top - 8 ? anchor.bottom + 8 : anchor.top - box.height - 8
    setPosition({
      left: Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - box.height - 12)),
    })
  }, [open, t])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); hide() }
    }
    const onPointer = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !tip.current?.contains(event.target as Node)) hide()
    }
    const onScroll = (event: Event) => {
      if (!tip.current?.contains(event.target as Node)) hide()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])
  useEffect(() => clearTimer, [clearTimer])

  return <>
    <button ref={trigger} type="button" className={styles.helpButton}
      aria-label={t('blueprint:review.mcpHelp.label')} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave} onClick={show}>
      <CircleHelp size={14} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div ref={tip} id={id} role="tooltip" className={styles.helpTip} style={position}
        onMouseEnter={clearTimer} onMouseLeave={leave}>
        <strong className={styles.helpTitle}>{t('blueprint:review.mcpHelp.title')}</strong>
        <p>{t('blueprint:review.mcpHelp.intro')}</p>
        <dl className={styles.helpFeatures}>
          {(['reading', 'writing', 'suggestions', 'workflow'] as const).map(key => <div key={key}>
            <dt>{t(`blueprint:review.mcpHelp.${key}Title`)}</dt>
            <dd>{t(`blueprint:review.mcpHelp.${key}`)}</dd>
          </div>)}
        </dl>
        <p className={styles.helpBoundary}>{t('blueprint:review.mcpHelp.boundary')}</p>
      </div>, document.body,
    )}
  </>
}
