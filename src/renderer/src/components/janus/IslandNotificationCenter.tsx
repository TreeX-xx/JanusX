import { useId, useLayoutEffect, useRef } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { PluginIslandPreview } from '@/extensions/plugin-island'
import { notificationActionLabelKey, type IslandNotificationActionId } from './islandNotifications'
import type { IslandNoticeRecord } from './islandSpeakQueue'

export function notificationClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export interface IslandNotificationCenterProps {
  entries: readonly IslandNoticeRecord[]
  unreadCount: number
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onClose: () => void
  onClear: (readOnly?: boolean) => void
  onAction: (id: string, action: IslandNotificationActionId, command?: string) => void
}

/** Shared reader for the capsule and Chat. Arrival never changes the selected row or scroll. */
export function IslandNotificationCenter({ entries, unreadCount, selectedKey, onSelect, onClose, onClear, onAction }: IslandNotificationCenterProps) {
  const { t } = useI18n('janus')
  const id = useId()
  const listRef = useRef<HTMLDivElement>(null)
  // Reveal the requested record once on opening; later arrivals stay out of the reader's way.
  useLayoutEffect(() => {
    const list = listRef.current
    const selected = list?.querySelector<HTMLElement>('[data-selected="true"]')
    if (list && selected) list.scrollTop = selected.offsetTop - list.offsetTop
    const focusTarget = selected?.querySelector<HTMLElement>('button') ?? list?.parentElement?.querySelector<HTMLElement>('.janus-notif-close')
    focusTarget?.focus({ preventScroll: true })
  }, [])
  return <section className="janus-notification-center" aria-label={t('janus:island.notif.title')}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <header className="janus-notif-head">
      <div><strong>{t('janus:island.notif.title')}</strong><span className="janus-notif-unread">{t('janus:island.notif.unreadCount', { count: unreadCount })}</span></div>
      <button type="button" className="janus-notif-close" aria-label={t('janus:island.aria.closeNotif')} onClick={onClose}><X size={15} /></button>
    </header>
    <div className="janus-notif-list" ref={listRef}>
      {entries.length === 0 ? <div className="janus-notif-empty">{t('janus:island.notif.empty')}</div> : entries.map((entry, index) => {
        const selected = selectedKey === entry.key
        const notification = entry.notification
        const detailId = `${id}-${index}`
        return <article className="janus-notif-row" key={entry.key} data-selected={selected} data-read={entry.read} data-severity={notification?.severity}>
          <button type="button" className="janus-notif-summary" aria-expanded={selected} aria-controls={detailId}
            onClick={() => onSelect(selected ? null : entry.key)}>
            <span className="janus-notif-meta"><span className="janus-notif-source">{entry.kicker}</span>{!entry.read && <span className="janus-notif-unread-label">{t('janus:island.notif.unread')}</span>}<time dateTime={new Date(entry.at).toISOString()}>{notificationClock(entry.at)}</time>{entry.count > 1 && <span>{t('janus:island.notif.repeated', { count: entry.count })}</span>}</span>
            <span className="janus-notif-summary-title">{entry.title || entry.body}<ChevronDown size={13} /></span>
            {!selected && entry.title && <span className="janus-notif-excerpt">{entry.body}</span>}
          </button>
          {selected && <div className="janus-notif-detail" id={detailId}>
            <p className="janus-notif-body">{entry.body}</p>
            {notification && <>
              <PluginIslandPreview notification={notification} />
              {notification.progress != null && <progress max={100} value={Math.max(0, Math.min(100, notification.progress))} />}
              <div className="janus-notif-actions">{notification.actions.map(action => <button type="button" key={action.command ?? action.id}
                className="janus-notif-action" onClick={() => onAction(notification.id, action.id, action.command)}>
                {action.label ?? t(notificationActionLabelKey(action.id))}
              </button>)}</div>
            </>}
          </div>}
        </article>
      })}
    </div>
    {entries.length > 0 && <footer className="janus-notif-footer">
      <button type="button" disabled={!entries.some(entry => entry.read)} onClick={() => onClear(true)}>{t('janus:island.notif.clearRead')}</button>
      <button type="button" onClick={() => onClear()}>{t('janus:island.capsule.tray.clearAll')}</button>
    </footer>}
  </section>
}
