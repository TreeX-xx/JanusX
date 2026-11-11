import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, Crosshair, Minus, Plus, X } from 'lucide-react'
import type { Memo } from '../../../../shared/memo'
import { useI18n } from '@/i18n/useI18n'
import { useIslandReveal } from '../island/islandMotion'
import { DEFAULT_CAMERA, STAR_ANNOTATION, boundCamera, connectionPath, projectStar, zoomCamera, type ConstellationCamera, type ConstellationPoint as Point } from './constellationGeometry'
import { clipStarConnection, insertionTarget, labelGeometry, placeLabels, reconcileStars, starConnection, type StarLayout } from './constellationLayout'
import { useConstellationMotion, type StarBirth } from './useConstellationMotion'

export interface MemoConstellationHandle { insert: (afterId: string | null) => void }
interface Props {
  memo: Memo; selectedId: string | null; reveal: boolean; layouts: Map<string, StarLayout>
  onSelect: (id: string) => void
  onCreate: (title: string, afterId: string | null, revision: number) => Promise<Memo>
}
interface StarDraft { origin: Point; afterId: string | null; beforeId: string | null; revision: number; title: string; error: string | null }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(Math.max(low, high), n))
const annotationStyle = {
  '--memo-caption-width': STAR_ANNOTATION.width + 'px',
  '--memo-title-height': STAR_ANNOTATION.titleHeight + 'px',
  '--memo-label-gap': '8px', '--memo-label-height': STAR_ANNOTATION.labelHeight + 'px',
} as CSSProperties

export const MemoConstellation = forwardRef<MemoConstellationHandle, Props>(function MemoConstellation({ memo, selectedId, reveal, layouts, onSelect, onCreate }, ref) {
  const { t } = useI18n('janus')
  const track = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [size, setSize] = useState({ width: 400, height: 160 })
  const [camera, setCamera] = useState<ConstellationCamera>(DEFAULT_CAMERA)
  const [hover, setHover] = useState<{ point: Point; afterId: string | null } | null>(null)
  const [draft, setDraft] = useState<StarDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const lifetime = useRef(0)
  const [birth, setBirth] = useState<StarBirth | null>(null)
  const [dragging, setDragging] = useState(false)
  const pan = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const suppressClickUntil = useRef(0)
  const order = memo.nodes.map(node => node.id).join(',')
  const layout = useMemo(() => reconcileStars(order ? order.split(',') : [], layouts.get(memo.id)), [order, layouts, memo.id])
  useLayoutEffect(() => { layouts.set(memo.id, layout) }, [layout, layouts, memo.id])
  const { points, moving, completedBirth } = useConstellationMotion(layout, birth, reveal)
  const current = useRef({ memo, size, layout, camera })
  current.current = { memo, size, layout, camera }
  const selectedPoint = layout.points[selectedId ?? '']
  const updateCamera = (value: ConstellationCamera) => boundCamera(value, current.current.size, current.current.memo.nodes.length, Object.values(current.current.layout.points))
  const unproject = (point: Point): Point => ({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale })
  useIslandReveal(track, reveal, memo.id)

  useLayoutEffect(() => {
    const element = track.current
    if (!element) return
    const resize = () => setSize(previous => element.clientWidth === previous.width && element.clientHeight === previous.height ? previous : { width: element.clientWidth, height: element.clientHeight })
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (!selectedPoint || birth?.id === selectedId) return
    setCamera(previous => {
      const point = projectStar(selectedPoint, previous)
      const x = point.x < 28 ? 36 - point.x : point.x > size.width - 136 ? Math.max(40, size.width - 136) - point.x : 0
      const y = point.y < 42 ? 44 - point.y : point.y > size.height - 26 ? size.height - 28 - point.y : 0
      return boundCamera({ ...previous, x: previous.x + x, y: previous.y + y }, size, memo.nodes.length, Object.values(layout.points))
    })
  }, [selectedId, selectedPoint, size, memo.nodes.length, layout, birth])
  useEffect(() => { if (birth && completedBirth === birth) setBirth(null) }, [birth, completedBirth])
  useEffect(() => {
    const generation = ++lifetime.current
    if (!reveal) { lifetime.current++; setDraft(null); setHover(null); setBirth(null); busyRef.current = false; setBusy(false) }
    return () => { lifetime.current = generation + 1 }
  }, [reveal])
  useEffect(() => {
    const element = track.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1)
      setHover(null)
      setCamera(previous => boundCamera(zoomCamera(previous, { x: event.clientX - box.left, y: event.clientY - box.top }, Math.exp(-Math.max(-300, Math.min(300, delta)) * .002)), current.current.size, current.current.memo.nodes.length, Object.values(current.current.layout.points)))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  const screenStars = memo.nodes.map(node => ({ node, id: node.id, point: projectStar(points[node.id] ?? layout.points[node.id], camera) }))
  const labelSides = useMemo(() => placeLabels(memo.nodes.map(node => ({ id: node.id, hasLabel: Boolean(node.label), point: projectStar(layout.points[node.id], camera) })), selectedId, size), [memo.nodes, layout, camera, selectedId, size])
  const annotations = screenStars.map(star => labelGeometry(star.point, Boolean(star.node.label), labelSides[star.id]))
  const obstacles = annotations.flatMap(annotation => annotation.boxes)
  const connections = screenStars.slice(1).map((star, index) => ({ id: screenStars[index].id, segments: starConnection(screenStars[index].point, star.point, screenStars[index].id) }))
  const targetBefore = (afterId: string | null) => memo.nodes[afterId === null ? 0 : memo.nodes.findIndex(node => node.id === afterId) + 1]?.id ?? null

  const begin = (point: Point, afterId: string | null) => {
    if (busyRef.current) return
    setHover(null)
    setDraft(previous => ({ origin: unproject(point), afterId, beforeId: targetBefore(afterId), revision: memo.revision, title: previous?.title ?? '', error: null }))
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
  }
  const insertAt = (afterId: string | null) => {
    const index = memo.nodes.findIndex(node => node.id === afterId)
    const before = screenStars[index]?.point
    const after = screenStars[index + 1]?.point
    const point = before && after ? { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 } : before ? { x: before.x + 70, y: before.y } : { x: size.width / 2 - 36, y: size.height / 2 }
    begin({ x: clamp(point.x, 32, size.width - 40), y: clamp(point.y, 36, size.height - 28) }, afterId)
  }
  useImperativeHandle(ref, () => ({ insert: insertAt }))

  const submit = async () => {
    if (!draft || busyRef.current) return
    if (!draft.title.trim()) { setDraft({ ...draft, error: t('janus:memo.required') }); input.current?.focus(); return }
    if ((draft.afterId !== null && !memo.nodes.some(node => node.id === draft.afterId)) || targetBefore(draft.afterId) !== draft.beforeId) {
      setDraft({ ...draft, error: t('janus:memo.anchorChanged') }); return
    }
    const generation = lifetime.current
    const known = new Set(memo.nodes.map(node => node.id))
    busyRef.current = true; setBusy(true)
    try {
      const result = await onCreate(draft.title.trim(), draft.afterId, draft.revision)
      if (generation !== lifetime.current) return
      const created = result.nodes.find(node => !known.has(node.id))
      setDraft(null)
      if (created) { setBirth({ id: created.id, origin: draft.origin }); onSelect(created.id) }
    } catch (reason) {
      if (generation !== lifetime.current) return
      const message = reason instanceof Error && reason.message.includes('MEMO_CONFLICT') ? t('janus:memo.conflict') : t('janus:memo.saveFailed')
      setDraft(previous => previous && ({ ...previous, revision: current.current.memo.revision, error: message }))
    } finally {
      if (generation === lifetime.current) { busyRef.current = false; setBusy(false) }
    }
  }
  const cancel = () => { if (!busyRef.current) { setDraft(null); setHover(null); track.current?.focus({ preventScroll: true }) } }
  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = Math.min(index + 1, memo.nodes.length - 1)
    else if (event.key === 'ArrowLeft') next = Math.max(index - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = memo.nodes.length - 1
    else return
    event.preventDefault(); event.stopPropagation()
    onSelect(memo.nodes[next].id)
    track.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true })
  }
  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const box = track.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const isControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, input, textarea, form'))
  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pan.current
    if (previous && previous.pointerId === event.pointerId) {
      event.preventDefault()
      setCamera(value => updateCamera({ ...value, x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }))
      pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      suppressClickUntil.current = performance.now() + 180
    } else if (!draft && !moving && !isControl(event.target)) {
      const point = localPoint(event)
      setHover({ point, afterId: insertionTarget(point, screenStars) })
    } else setHover(null)
  }
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return
    pan.current = null; setDragging(false)
    suppressClickUntil.current = performance.now() + 180
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const centerSelection = () => { setHover(null); setCamera(!selectedPoint ? DEFAULT_CAMERA : updateCamera({ scale: 1, x: Math.max(40, size.width / 2 - 48) - selectedPoint.x, y: size.height / 2 - selectedPoint.y })) }
  const zoom = (factor: number) => { setHover(null); setCamera(previous => updateCamera(zoomCamera(previous, { x: size.width / 2, y: size.height / 2 }, factor))) }
  const preview = draft ? { point: projectStar(draft.origin, camera), afterId: draft.afterId } : hover
  const previewIndex = preview ? memo.nodes.findIndex(node => node.id === preview.afterId) : -1
  const previewBefore = screenStars[previewIndex]
  const previewAfter = screenStars[previewIndex + 1]
  const previewText = !memo.nodes.length ? t('janus:memo.firstStar') : !previewBefore ? t('janus:memo.beforeTitle', { title: previewAfter?.node.title ?? '' }) : previewAfter ? t('janus:memo.betweenTitles', { before: previewBefore.node.title, after: previewAfter.node.title }) : t('janus:memo.afterTitle', { title: previewBefore.node.title })
  const starIcon = <svg className="memo-star-glyph" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M 0 -6 L 1.5 -1.5 L 6 0 L 1.5 1.5 L 0 6 L -1.5 1.5 L -6 0 L -1.5 -1.5 Z" /><circle r="1.8" /></svg>

  return <nav className="memo-constellation" aria-label={t('janus:memo.nodeNavigation')} style={annotationStyle}>
    <div className="memo-constellation-toolbar">
      <span title={t('janus:memo.cameraHint')}>{t('janus:memo.cameraHint')}</span>
      <button type="button" aria-label={t('janus:memo.zoomOut')} onClick={() => zoom(1 / 1.2)}><Minus size={12} /></button>
      <button type="button" aria-label={t('janus:memo.zoomIn')} onClick={() => zoom(1.2)}><Plus size={12} /></button>
      <button type="button" aria-label={t('janus:memo.centerStar')} title={t('janus:memo.centerStar')} onClick={centerSelection}><Crosshair size={12} /></button>
      <button type="button" aria-label={t('janus:memo.addNode')} title={t('janus:memo.addNode')} onClick={() => insertAt(memo.nodes.at(-1)?.id ?? null)}><Plus size={13} /></button>
    </div>
    <div ref={track} className="memo-star-track" data-dragging={dragging} data-moving={moving} data-camera-scale={camera.scale} data-camera-x={camera.x} data-camera-y={camera.y} role="tablist" tabIndex={0} aria-label={t('janus:memo.nodeNavigation')}
      onPointerLeave={() => setHover(null)}
      onPointerDown={event => {
        if (event.button !== 1) return
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
        pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        setDragging(true); setHover(null)
      }} onPointerMove={movePointer} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
      onAuxClick={event => { if (event.button === 1) event.preventDefault() }}
      onClickCapture={event => { if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation() } }}
      onClick={event => {
        if (isControl(event.target) || moving || dragging || event.button !== 0) return
        const point = localPoint(event)
        begin(point, insertionTarget(point, screenStars))
      }}
      onKeyDown={event => {
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2) }
        else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2) }
        else if (event.key === '0') { event.preventDefault(); centerSelection() }
        else if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); insertAt(memo.nodes.at(-1)?.id ?? null) }
        else if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          setCamera(value => updateCamera({ ...value, x: value.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: value.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }))
        }
      }}>
      <svg className="memo-star-lines" aria-hidden="true">
        {connections.map(edge => <path key={edge.id} className="memo-star-connection" data-after-id={edge.id} data-previewed={preview?.afterId === edge.id} data-island-reveal="line" pathLength="1" d={connectionPath(clipStarConnection(edge.segments, obstacles))} />)}
        {preview && [previewBefore?.point, previewAfter?.point].filter((point): point is Point => Boolean(point)).map((point, index) => <path key={index} className="memo-star-preview-line" d={connectionPath(clipStarConnection(starConnection(point, preview.point, 'preview'), obstacles))} />)}
      </svg>
      {screenStars.map(({ node, point }, index) => {
        const annotation = annotations[index]
        return <button key={node.id} id={'memo-tab-' + node.id} className="memo-star" data-node-id={node.id} data-label-side={annotation.side} data-born={birth?.id === node.id} data-island-reveal type="button" role="tab" aria-label={node.title} title={node.title + (node.label ? ' · ' + node.label : '')} aria-selected={selectedId === node.id} aria-controls={'memo-body-' + memo.id} tabIndex={selectedId === node.id ? 0 : -1} onClick={() => onSelect(node.id)} onKeyDown={event => selectWithKeyboard(event, index)} style={{ left: point.x - 16, top: point.y - 16 }}>
          {starIcon}<svg className="memo-star-leader" viewBox="0 0 136 1" aria-hidden="true"><path d={annotation.path} /></svg>
          <span className="memo-star-caption" style={{ left: 16 + annotation.textLeft, top: 16 + annotation.titleTop, textAlign: annotation.side.endsWith('w') ? 'right' : 'left' }}><span className="memo-star-title">{node.title}</span>{node.label && <span className="memo-star-label">{node.label}</span>}</span>
        </button>
      })}
      {preview && <div className="memo-star-ghost" data-pending={Boolean(draft)} data-after-id={preview.afterId ?? ''} style={{ left: preview.point.x - 8, top: preview.point.y - 8 }}>{starIcon}</div>}
      {!memo.nodes.length && !draft && <button className="memo-first-star" type="button" onClick={() => insertAt(null)}><Plus size={13} />{t('janus:memo.firstStar')}</button>}
    </div>
    {draft && preview && <form className="memo-star-composer" role="dialog" aria-label={t('janus:memo.addNode')} style={{ left: clamp(preview.point.x + 18, 8, size.width - 238), bottom: clamp(size.height - preview.point.y + 16, 8, size.height - 10) }}
      onSubmit={event => { event.preventDefault(); void submit() }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel() } if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}>
      <span className="memo-star-target" title={previewText}>{previewText}</span>
      <input ref={input} autoFocus aria-label={t('janus:memo.nodeTitle')} placeholder={t('janus:memo.starPlaceholder')} maxLength={120} value={draft.title} disabled={busy} onChange={event => setDraft({ ...draft, title: event.target.value, error: null })} />
      {draft.error && <p role="alert">{draft.error}</p>}
      <div className="memo-composer-actions"><span>{busy ? t('janus:memo.saving') : t('janus:memo.confirmHint')}</span><button type="button" aria-label={t('janus:memo.cancel')} disabled={busy} onClick={cancel}><X size={14} /></button><button type="submit" aria-label={t('janus:memo.confirm')} disabled={busy}><Check size={14} /></button></div>
    </form>}
    {!draft && hover && <div className="memo-insertion-preview" aria-hidden="true">{previewText}</div>}
  </nav>
})
