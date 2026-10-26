import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** Native top-layer panels keep source/review lists out of the card grid. */
export function WorkbenchPopover({ label, children, triggerContent, className = '' }: { label: string; children: ReactNode; triggerContent?: ReactNode; className?: string }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const body = panel.current!
    body.setAttribute('popover', 'auto')
    trigger.current!.setAttribute('popovertarget', id)
    const toggle = (event: Event) => setOpen((event as ToggleEvent).newState === 'open')
    const close = () => body.hidePopover()
    body.addEventListener('toggle', toggle)
    window.addEventListener('resize', close)
    return () => { body.removeEventListener('toggle', toggle); window.removeEventListener('resize', close) }
  }, [id])
  return <>
    <button ref={trigger} type="button" className={`blueprint-btn ${className}`} aria-label={label} title={label} aria-expanded={open} aria-controls={id}
      onClick={() => {
        const rect = trigger.current!.getBoundingClientRect(), body = panel.current!
        body.style.top = `${rect.bottom + 6}px`
        body.style.left = `${Math.max(8, Math.min(rect.right - Math.min(560, innerWidth - 32), innerWidth - 576))}px`
      }}>{triggerContent ?? label}</button>
    <div ref={panel} id={id} className="blueprint-workbench-popover" role="region" aria-label={label}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); panel.current?.hidePopover(); trigger.current?.focus() }
      }}>{children}</div>
  </>
}
