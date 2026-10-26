import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { diffLines } from 'diff'
import { Check, LoaderCircle, ArrowRight, ChevronRight, X } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { useNoteRepairStore, noteRepairKey, type RepairCardState, type RepairSyncPart } from '@/stores/note-repair'
import { repairIsActive, type NoteRepairDiff } from '../../../../../plugins/blueprint/src/shared/note-repair'
import type { UseJanusChatReturn } from '../janus/useJanusChat'
import './note-repair.css'
import './blueprint-disclosure.css'

// Note: a real issue card transfers to Janus and remains through verification — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
export function NoteRepairCard({ card, onStop, execution }: { card: RepairCardState; onStop(): void; execution?: UseJanusChatReturn | null }) {
  const { t } = useI18n('blueprint')
  const [expanded, setExpanded] = useState(false)
  const destination = useRef<HTMLElement>(null), flying = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState(Boolean(card.source && !card.transferred))
  const [diff, setDiff] = useState<NoteRepairDiff | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const currentId = useRef(card.id); currentId.current = card.id
  const root = card.input.context.workspacePath
  const active = repairIsActive(card.phase)
  const reviewIncomplete = card.phase === 'review-incomplete' || card.changed && ['failed', 'cancelled'].includes(card.phase) && card.input.kind === 'suggestions'
  const outcome = card.phase === 'resolved' ? t(card.changed ? 'repair.passed' : 'repair.alreadyCorrect')
    : card.phase === 'unresolved' ? t('repair.newFindings', { count: card.remaining ?? 0 })
      : reviewIncomplete ? t(card.changed ? 'repair.reviewFailed' : 'repair.reviewIncomplete') : t('repair.phase.' + card.phase)
  useEffect(() => { setDiff(null); setError(''); setBusy(false); setExpanded(false) }, [card.id])
  useEffect(() => {
    if (!card.source || card.transferred || !destination.current || !flying.current) { setMoving(false); return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setMoving(false); return }
    let frame = 0, attempts = 0, stable = 0, previous = '', cancelled = false
    let animation: Animation | undefined
    const finish = () => {
      if (cancelled) return
      setMoving(false)
      const current = useNoteRepairStore.getState().cards[noteRepairKey(root)]
      if (current?.source === card.source) useNoteRepairStore.getState().transferred(root, current.id)
    }
    const measure = () => {
      const target = destination.current?.getBoundingClientRect(), element = flying.current
      if (!target || !element) return finish()
      const position = [target.x, target.y, target.width, target.height].map(Math.round).join(',')
      stable = position === previous ? stable + 1 : 0; previous = position
      // Wait for the existing right-panel entrance to settle, bounded to 36 frames.
      if (++attempts < 36 && stable < 4) { frame = requestAnimationFrame(measure); return }
      const source = card.source!
      element.style.width = target.width + 'px'; element.style.height = target.height + 'px'
      element.style.left = target.x + 'px'; element.style.top = target.y + 'px'
      animation = element.animate([
        { transform: 'translate(' + (source.x - target.x) + 'px,' + (source.y - target.y) + 'px) scale(' + source.width / target.width + ',' + source.height / target.height + ')', opacity: 0.94 },
        { transform: 'translate(0,0) scale(1,1)', opacity: 1 },
      ], { duration: 440, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' })
      animation.finished.then(finish).catch(() => {})
    }
    frame = requestAnimationFrame(measure)
    return () => { cancelled = true; cancelAnimationFrame(frame); animation?.cancel() }
    // The source identity survives preparing -> queued; phase updates do not restart the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.source, root])
  const loadDiff = async () => {
    setBusy(true); setError('')
    try { const value = await window.electron.blueprintReview.repairDiff(card.id); if (currentId.current === card.id) setDiff(value) }
    catch (reason) { if (currentId.current === card.id) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (currentId.current === card.id) setBusy(false) }
  }
  const undo = async () => {
    setBusy(true); setError('')
    try {
      const update = await window.electron.blueprintReview.repairUndo(card.id)
      useNoteRepairStore.getState().receive(update)
      const value = await window.electron.blueprintReview.repairDiff(card.id)
      if (currentId.current === card.id) setDiff(value)
      await useNoteRepairStore.getState().refresh(root)
    } catch (reason) { if (currentId.current === card.id) setError(reason instanceof Error ? reason.message : String(reason)); await useNoteRepairStore.getState().refresh(root) }
    finally { if (currentId.current === card.id) setBusy(false) }
  }
  const content = <><header><span className="bp-note-repair__label">{t(card.input.intent === 'discuss' ? 'repair.discussion' : 'repair.title')}</span>
    {active ? <LoaderCircle size={15} className="bp-note-repair__spinner" /> : card.phase === 'resolved' ? <Check size={15} /> : <ArrowRight size={15} />}</header>
    <strong className="bp-note-repair__title">{card.title}</strong><ul>{card.summaries.map((summary, index) => <li key={index}>{summary}</li>)}</ul></>
  return <>
    <section ref={destination} className="bp-note-repair" data-phase={card.phase} data-transferring={moving} aria-label={t('repair.title')} aria-busy={active}>
      <div className="bp-note-repair__content">
        <div className="bp-note-repair__summary">
          <button type="button" className="bp-note-repair__toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            <strong className="bp-note-repair__title">{card.title}</strong>
            <span>{outcome}</span>
          </button>
          {active && <LoaderCircle size={15} className="bp-note-repair__spinner" />}
        </div>
        <div className="bp-note-repair__status" role="status"><button type="button" className="bp-note-repair__details-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronRight className="bp-disclosure-chevron" size={14} aria-hidden="true" />{t(expanded ? 'repair.details' : 'repair.openDetails')}</button>
          {active && <button type="button" onClick={() => {
            useNoteRepairStore.getState().cancel(root)
            if (card.reviewOnly && card.plan) void window.electron.blueprintReview.cancel(root, card.plan.noteId).catch(reason => setError(String(reason)))
            else if (card.started) onStop()
          }} aria-label={t('review.cancel')}><X size={14} /></button>}</div>
        {!active && card.error && !expanded && <p role="alert">{card.error}</p>}
        {card.changes && <p className="bp-note-repair__change-summary">{t('repair.changeSummary', card.changes)}</p>}
        {!active && <div className="bp-note-repair__actions">
          {reviewIncomplete && <button type="button" onClick={() => void useNoteRepairStore.getState().retryReview(root)}>{t('repair.retryReview')}</button>}
          {card.changed && <button type="button" disabled={busy} onClick={() => { setExpanded(true); void loadDiff() }}>{t('repair.diff')}</button>}
        </div>}
        {card.recordError && <p role="alert">{card.recordError}</p>}
        {(['source', 'suggestions'] as RepairSyncPart[]).map(part => {
          const sync = card.sync?.[part]
          if (!sync || (sync.state === 'ready' && !expanded)) return null
          return <p key={part} role={sync.state === 'error' ? 'alert' : 'status'} data-sync={part} aria-busy={sync.state === 'loading'}>
            {t(part === 'source' ? 'repair.syncSource' : 'repair.syncSuggestions')} · {t(sync.state === 'loading' ? 'repair.syncLoading' : sync.state === 'ready' ? 'repair.syncReady' : 'repair.syncError')}
            {sync.error && <> {sync.error}</>}
            {sync.state !== 'ready' && <button type="button" disabled={sync.state === 'loading'} onClick={() => void useNoteRepairStore.getState().refresh(root, part)}>{t(sync.state === 'loading' ? 'repair.syncLoading' : 'repair.syncRetry')}</button>}
          </p>
        })}
        <div className="bp-note-repair__details" hidden={!expanded}>
        <ul>{card.summaries.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
        {card.input.intent === 'repair' && <ol className="bp-note-repair__steps" aria-label={t('repair.progress')}>
          {['reading', 'editing', 'reviewing'].map((step, index) => <li key={step} data-active={card.phase === step} data-done={card.phase === 'resolved' || ['reading', 'editing', 'reviewing'].indexOf(card.phase) > index}>{t('repair.phase.' + step)}</li>)}
        </ol>}
        {card.phase === 'resolved' && <p>{outcome}</p>}
        {card.phase === 'unresolved' && <p>{t('repair.remaining', { count: card.remaining ?? 0 })}</p>}
        {card.error && <p role="alert">{card.error}</p>}
        {!active && <div className="bp-note-repair__actions">
          {!reviewIncomplete && ['failed', 'cancelled', 'unresolved', 'unchanged'].includes(card.phase) && <button type="button" onClick={() => void useNoteRepairStore.getState().retry(root)}>{t('repair.retry')}</button>}
          {card.changed && diff && <button type="button" disabled={busy || diff.reverted} onClick={() => void undo()}>{t(diff.reverted ? 'repair.reverted' : card.input.kind === 'suggestions' ? 'repair.undoReview' : 'repair.undo')}</button>}
        </div>}
        {error && <p role="alert">{error}</p>}
        {execution && <details className="bp-note-repair__execution"><summary>{t('repair.execution')}</summary>
          {execution.toolTraces.map(trace => <p key={trace.toolName + trace.startedAt}>{trace.toolName} · {trace.status}{trace.summary ? ' · ' + trace.summary : ''}</p>)}
          {execution.messages.map(message => <p key={message.id}>{message.content}</p>)}
          {execution.pendingContent && <p>{execution.pendingContent}</p>}
          {execution.error && <p role="alert">{execution.error}</p>}
        </details>}
        {diff && <details open className="bp-note-repair__diff"><summary>{diff.path}</summary><pre>{diffLines(diff.before, diff.after).map((part, index) => <span key={index} data-change={part.added ? 'add' : part.removed ? 'remove' : 'same'}>{part.value}</span>)}</pre></details>}
        </div>
      </div>
    </section>
    {moving && card.source && createPortal(<div ref={flying} className="bp-note-repair bp-note-repair--flying" style={{ left: card.source.x, top: card.source.y, width: card.source.width, height: card.source.height }} aria-hidden="true">{content}</div>, document.body)}
  </>
}
