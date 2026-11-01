import { useId, useLayoutEffect, useRef } from 'react'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './AgentSessionPane.module.css'

export function ConversationMessageEditor({ text, setText, busy, disabled, error, cancel, submit }: {
  text: string; setText(text: string): void; busy: boolean; disabled: boolean; error: string
  cancel(): void; submit(): Promise<void>
}) {
  const { t } = useTranslation('terminal')
  const input = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.setSelectionRange(text.length, text.length)
    input.current?.scrollIntoView({ block: 'nearest' })
    // Focus once when opening; typing must retain its selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    const resize = () => { el.style.height = '0px'; el.style.height = `${Math.min(el.scrollHeight, 280)}px` }
    resize()
    let width = el.clientWidth
    const observer = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; resize() } })
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])
  return <form className={styles.messageEditor} aria-label={t('conversation.editMessage')} aria-busy={busy} onSubmit={event => {
    event.preventDefault()
    if (!disabled && !busy && text.trim()) void submit()
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || busy) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.requestSubmit() }
  }}>
    <label className={styles.editLabel}><Pencil size={13} aria-hidden="true" />{t('conversation.editMessage')}
      <textarea ref={input} value={text} onChange={event => setText(event.target.value)} aria-label={t('conversation.editText')} aria-describedby={hintId} readOnly={busy} maxLength={32000} rows={2} />
    </label>
    <div className={styles.editFooter}>
      <p id={hintId}>{t('conversation.editHint')}</p>
      <div className={styles.editButtons}>
        <button type="button" disabled={busy} onClick={cancel}>{t('conversation.editCancel')}</button>
        <button type="submit" className={styles.editSubmit} disabled={disabled || busy || !text.trim()}>{busy && <span className={styles.modeSpinner} aria-hidden="true" />}{t(busy ? 'conversation.editSubmitting' : 'conversation.editSubmit')}</button>
      </div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </form>
}
