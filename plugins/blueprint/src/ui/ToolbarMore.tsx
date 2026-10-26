import { useId, useRef, useState, useEffect, type ReactNode } from 'react'
import { Ellipsis } from './WorkbenchIcons'
import { blueprintText as t } from './blueprint-text'

export function ToolbarMore({ children }: { children: ReactNode }) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const menu = panel.current!
    menu.setAttribute('popover', 'auto')
    button.current!.setAttribute('popovertarget', id)
    const update = (event: Event) => setOpen((event as ToggleEvent).newState === 'open')
    const close = () => menu.hidePopover()
    menu.addEventListener('toggle', update)
    window.addEventListener('resize', close)
    return () => { menu.removeEventListener('toggle', update); window.removeEventListener('resize', close) }
  }, [id])
  return <>
    <button ref={button} type="button" className="blueprint-btn blueprint-toolbar__more" aria-label={t('blueprint:action.more')}
      onKeyDown={event => {
        if (panel.current?.matches(':popover-open') && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.current.hidePopover() }
      }}
      aria-expanded={open} aria-controls={id} onClick={() => {
        const rect = button.current!.getBoundingClientRect()
        const menu = panel.current!
        menu.style.top = `${rect.bottom + 6}px`
        menu.style.left = `${Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248))}px`
      }}><Ellipsis size={17} aria-hidden="true" /></button>
    <div id={id} ref={panel} className="blueprint-toolbar-menu" aria-label={t('blueprint:action.more')}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); panel.current?.hidePopover(); button.current?.focus() }
      }}
      onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) { panel.current?.hidePopover(); button.current?.focus() } }}>
      {children}
    </div>
  </>
}
