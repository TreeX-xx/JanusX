import { useEffect, useRef, useState } from 'react'
import { Copy, ArrowDown, Pause } from 'lucide-react'
import { api, call } from './bridge'
import { useLocale, errorText } from './i18n'
import type { ContainerView, LogBatch } from '../shared/docker'
export function LogsPane({ container, view, update }: { container: string; view: ContainerView; update(patch: Partial<ContainerView>): void }) {
  const t = useLocale(), [text, setText] = useState(''), [trimmed, setTrimmed] = useState(false), [ended, setEnded] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  const body = useRef<HTMLPreElement>(null), state = useRef(view); state.current = view
  const restored = useRef(false), scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current) }, [])
  useEffect(() => {
    let disposed = false, subscription = '', off: (() => void) | undefined
    setText(''); setTrimmed(false); setEnded(false); setError('')
    void (async () => {
      off = await api.native.watch(event => {
        const batch = event.value as unknown as LogBatch
        if (disposed || event.name !== 'docker.logs' || batch.subscription !== subscription) return
        setText(previous => { const next = previous + batch.text; if (next.length > 256 * 1024) setTrimmed(true); return next.slice(-256 * 1024) })
        if (batch.truncated) setTrimmed(true); if (batch.ended) setEnded(true); if (batch.error) setError(errorText(batch.error))
      })
      if (disposed) { off(); return }
      const result = await call<{ subscription: string }>('logs.subscribe', { id: container }); subscription = result.subscription
      if (disposed) await call('logs.unsubscribe', { subscription })
    })().catch(cause => { if (!disposed) setError(errorText(cause)) })
    return () => { disposed = true; off?.(); if (subscription) void call('logs.unsubscribe', { subscription }).catch(() => {}) }
  }, [container])
  useEffect(() => {
    const node = body.current
    if (!node) return
    if (!view.paused) node.scrollTop = node.scrollHeight
    else if (!restored.current && text) { node.scrollTop = view.scroll; restored.current = true }
  }, [text, view.paused, view.logSearch])
  const visible = view.logSearch ? text.split('\n').filter(line => line.toLowerCase().includes(view.logSearch.toLowerCase())).join('\n') : text
  return <div className="logs-pane">
    <div className="sub-toolbar"><input aria-label={t('logSearch')} placeholder={t('logSearch')} value={view.logSearch} onChange={event => update({ logSearch: event.target.value })}/>
      <button className="icon" title={view.paused ? t('follow') : t('pause')} aria-label={view.paused ? t('follow') : t('pause')} aria-pressed={!view.paused} onClick={() => update({ paused: !view.paused })}>{view.paused ? <ArrowDown size={14}/> : <Pause size={14}/>}</button>
      <button className="icon" title={t('copy')} aria-label={t('copy')} onClick={() => { void call('logs.copy', { text: visible }).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(cause => setError(errorText(cause))) }}><Copy size={14}/></button>
    </div>
    {(trimmed || ended || copied) && <p className="hint log-notice" role="status">{copied ? t('copied') : trimmed ? t('truncated') : t('logEnded')}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <pre ref={body} className="logs" onScroll={() => {
      if (!state.current.paused || scrollTimer.current) return
      scrollTimer.current = setTimeout(() => { scrollTimer.current = undefined; if (body.current) update({ scroll: body.current.scrollTop }) }, 180)
    }}>{visible || t('logWaiting')}</pre>
  </div>
}
