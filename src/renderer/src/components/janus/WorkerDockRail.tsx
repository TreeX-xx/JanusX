import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'
import type { ReportTarget } from './SuperAgentPresentation'
import { WorkerElapsed } from './WorkerMetadata'
import { workerTiming } from './workerPresentation'
import styles from './WorkerDockRail.module.css'

export interface WorkerDockEntry {
  id: string; title: string; status: string; phase: string; running: boolean; unread: boolean
  worker?: SuperAgentWorkerSnapshot; branch?: string; report?: ReportTarget
}

/** Presentation only: a retained monitor rail never starts, stops or resumes work. */
export function WorkerDockRail({ entries, visible, reveal, openReport }: {
  entries: WorkerDockEntry[]; visible: boolean; reveal(id: string): void; openReport(entry: WorkerDockEntry, trigger: HTMLElement): void
}) {
  const { t } = useTranslation('janus'), id = useId()
  const [selected, select] = useState<string | null>(null), [position, place] = useState({ left: 0, top: 0 })
  const anchor = useRef<HTMLButtonElement | null>(null), popup = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(), restoring = useRef(false)
  const entry = entries.find(row => row.id === selected)
  const hide = useCallback(() => { clearTimeout(timer.current); select(null) }, [])
  const show = (row: WorkerDockEntry, button: HTMLButtonElement) => {
    if (restoring.current) return
    clearTimeout(timer.current); anchor.current = button; select(row.id)
  }
  const later = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!anchor.current?.matches(':hover') && !popup.current?.matches(':hover') && document.activeElement !== anchor.current && !popup.current?.contains(document.activeElement)) hide()
    }, 140)
  }
  useEffect(() => { if (!visible || !entry) hide() }, [visible, entry, hide])
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!visible || !selected || !popup.current || !anchor.current) return
    const update = () => {
      if (!popup.current || !anchor.current) return
      const rect = anchor.current.getBoundingClientRect(), box = popup.current.getBoundingClientRect()
      place({ left: Math.max(8, rect.left - box.width - 8), top: Math.max(8, Math.min(rect.top, innerHeight - box.height - 8)) })
    }
    update()
    const resize = new ResizeObserver(update); resize.observe(popup.current)
    window.addEventListener('resize', hide)
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) hide() }
    window.addEventListener('scroll', scroll, true)
    return () => { resize.disconnect(); window.removeEventListener('resize', hide); window.removeEventListener('scroll', scroll, true) }
  }, [selected, visible, hide])
  useEffect(() => {
    if (!selected) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); hide(); restoring.current = true; anchor.current?.focus({ preventScroll: true }); restoring.current = false
    }
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) hide() }
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside) }
  }, [selected, hide])
  return <>
    <nav className={styles.rail} data-monitor-rail="" aria-label={t('superagent.monitorRail')} hidden={!visible}>
      <div className={styles.list}>{visible && entries.map(row => <button key={row.id} type="button" className={styles.item} data-rail-work-id={row.id} data-phase={row.phase} data-running={row.running} data-unread={row.unread}
        aria-label={`${row.title} · ${row.status}${row.unread ? ' · ' + t('superagent.unreadReport') : ''}`} aria-expanded={selected === row.id} aria-controls={selected === row.id ? id : undefined}
        onPointerEnter={event => { if (event.pointerType !== 'touch') show(row, event.currentTarget) }} onPointerLeave={later}
        onFocus={event => show(row, event.currentTarget)} onBlur={later} onClick={event => show(row, event.currentTarget)}>
        <span className={styles.dot} aria-hidden="true" /><span className={styles.elapsed}>{row.worker && workerTiming(row.worker, Date.now()) ? <WorkerElapsed worker={row.worker} /> : '—'}</span>
        {row.unread && <ClipboardList className={styles.unread} size={11} aria-hidden="true" />}
      </button>)}{!entries.length && <span className={styles.empty} title={t('superagent.noWorkers')}><Inbox size={14} aria-hidden="true" /></span>}</div>
    </nav>
    {visible && entry && createPortal(<section ref={popup} id={id} className={styles.peek} style={position} role="region" aria-label={t('superagent.workerPreview')}
      onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={later} onBlur={later}>
      <strong>{entry.title}</strong><p>{entry.status}</p>{entry.branch && <p>{entry.branch}</p>}
      <footer><button type="button" onClick={() => { hide(); reveal(entry.id) }}>{t('superagent.expandWorker')}</button>
        {entry.report && <button type="button" onClick={() => { const trigger = anchor.current; hide(); if (trigger) openReport(entry, trigger) }}>{t('superagent.viewReport')}</button>}</footer>
    </section>, document.body)}
  </>
}
