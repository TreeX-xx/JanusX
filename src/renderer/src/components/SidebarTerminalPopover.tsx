// Note: .agents/notes/terminal/terminal-sidebar-states.md
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import type { Terminal, Workspace } from '@/types'
import { getTerminalStatusVisual, summarizeTerminalActivity, TERMINAL_ATTENTION_ORDER } from '@/lib/terminal-sidebar-visual'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import { TerminalStatusLight } from './ui/TerminalStatusLight'
import styles from './Sidebar.module.css'

export function SidebarTerminalPopover({ workspace, terminals, activeTerminalId, anchor, onSelect, onClose }: {
  workspace: Workspace
  terminals: Terminal[]
  activeTerminalId: string | null
  anchor: HTMLElement
  onSelect: (terminal: Terminal) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const dismiss = useCallback((restoreFocus = true) => {
    if (restoreFocus && anchor.isConnected && !anchor.closest('[inert]')) anchor.focus({ preventScroll: true })
    onClose()
  }, [anchor, onClose])

  useLayoutEffect(() => {
    const sidebar = anchor.closest('aside')
    const place = () => {
      const panel = panelRef.current
      if (!panel || !anchor.isConnected) return
      const rect = anchor.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min((sidebar?.getBoundingClientRect().right ?? rect.right) + 8, window.innerWidth - panel.offsetWidth - 8)),
        top: Math.max(8, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 8)),
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panelRef.current) observer.observe(panelRef.current)
    if (sidebar) observer.observe(sidebar)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const target = panel?.querySelector<HTMLElement>('[data-quick-terminal][aria-current="true"]') ?? panel?.querySelector<HTMLElement>('[data-quick-terminal]')
    ;(target ?? panel)?.focus({ preventScroll: true })
  }, [workspace.id])

  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !anchor.contains(event.target)) dismiss(false)
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      dismiss()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [anchor, dismiss])

  const sorted = [...terminals].sort((a, b) => (TERMINAL_ATTENTION_ORDER[a.status] ?? 99) - (TERMINAL_ATTENTION_ORDER[b.status] ?? 99))
  return createPortal(<div
    ref={panelRef}
    id="workspace-terminal-popover"
    role="dialog"
    tabIndex={-1}
    aria-label={t('common:workspace.quickTerminals', { name: workspace.name })}
    className={styles.terminalPopover}
    style={position}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault(); event.stopPropagation(); dismiss(); return
      }
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Tab' && ((event.shiftKey && index <= 0) || (!event.shiftKey && index === buttons.length - 1))) {
        event.preventDefault(); dismiss(); return
      }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }}
  >
    <div className={styles.popoverHeader}>
      <strong>{workspace.name}</strong>
      <button type="button" className={styles.railAction} aria-label={t('common:workspace.closeQuickTerminals')} onClick={() => dismiss()}><X size={14} aria-hidden="true" /></button>
    </div>
    <p className={styles.popoverPath}>{workspace.path}</p>
    <p className={styles.popoverSummary}>{t('common:workspace.activitySummary', summarizeTerminalActivity(terminals))}</p>
    <div className={styles.popoverList}>
      {sorted.length ? sorted.map(terminal => <button
        key={terminal.id}
        type="button"
        data-quick-terminal={terminal.id}
        aria-current={terminal.id === activeTerminalId ? 'true' : undefined}
        className={`${styles.terminalRow} ${styles.quickTerminal}`}
        onClick={() => { onSelect(terminal); dismiss() }}
      >
        <TerminalPresetIcon preset={terminal.preset} alt="" className="h-3.5 w-3.5" />
        <span className={styles.quickTerminalText}>
          <span className={styles.terminalName}>{terminal.name || terminal.preset}</span>
          <span className={styles.quickTerminalPath}>{terminal.cwd}</span>
          <span className={styles.quickTerminalStatus}>{t(getTerminalStatusVisual(terminal.status).labelKey)}</span>
        </span>
        <TerminalStatusLight status={terminal.status} />
      </button>) : <p className={styles.popoverSummary}>{t('common:workspace.terminal.empty')}</p>}
    </div>
  </div>, document.body)
}
