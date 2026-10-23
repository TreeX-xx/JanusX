import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import './viewer-controls.css'
import { ViewerActive } from './ViewerToolbar'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'

export function ToolbarMenu({ label, children, icon: Icon = Ellipsis }: { label: string; children: ReactNode; icon?: LucideIcon }) {
  const [open, setOpen] = useState(false)
  const active = useContext(ViewerActive)
  useBrowserOcclusion(open)
  useEffect(() => { if (!active) setOpen(false) }, [active])
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const rect = panel.current.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - rect.height - 8)) })
    panel.current.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)')?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])
  return <>
    <ThemedTooltip label={label} disabled={open}>
      <button ref={trigger} type="button" className="shell-icon-btn viewer-icon" aria-label={label}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(value => !value)}><Icon size={15} aria-hidden="true" /></button>
    </ThemedTooltip>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} className="viewer-menu"
      style={position} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false)
      }} onClick={event => {
        if ((event.target as HTMLElement).closest('button:not([data-keep-menu])')) {
          setOpen(false)
          trigger.current?.focus()
        }
      }}>{children}</div>, document.body)}
  </>
}
