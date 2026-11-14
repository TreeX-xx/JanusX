// Note: .agents/notes/agent/superagent-interface.md — presentation only, never starts execution.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import wordmark from '../../assets/superagent-wordmark.svg'
import styles from './SuperAgentStartup.module.css'

const MIN_VISIBLE_MS = 2600
const EXIT_MS = 420

export function SuperAgentStartup({ ready, active, onComplete }: { ready: boolean; active: boolean; onComplete: () => void }) {
  const { t } = useTranslation('janus')
  const canvas = useRef<HTMLCanvasElement>(null)
  const lockup = useRef<HTMLHeadingElement>(null)
  const visibleMs = useRef(0)
  const animationMs = useRef(0)
  const [settled, setSettled] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const running = active && pageVisible

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    const visibility = () => setPageVisible(!document.hidden)
    media.addEventListener('change', update)
    document.addEventListener('visibilitychange', visibility)
    return () => { media.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility) }
  }, [])

  useEffect(() => {
    if (!running) { setSettled(false); return }
    const started = performance.now()
    let settle: ReturnType<typeof setTimeout> | undefined
    let finish: ReturnType<typeof setTimeout> | undefined
    // Count visible presentation time, not time spent in a hidden pane or background window.
    // Actual restoration may take longer; no timer can bypass it.
    if (ready) settle = setTimeout(() => {
      setSettled(true)
      finish = setTimeout(onComplete, reduced ? 0 : EXIT_MS)
    }, reduced ? 0 : Math.max(0, MIN_VISIBLE_MS - visibleMs.current))
    else setSettled(false)
    return () => { visibleMs.current += performance.now() - started; clearTimeout(settle); clearTimeout(finish) }
  }, [running, ready, reduced, onComplete])

  useEffect(() => {
    const surface = canvas.current, context = surface?.getContext('2d')
    if (!surface || !context) {
      lockup.current?.style.setProperty('--logo-reveal', '100%')
      return
    }
    if (!running) return
    let frame = 0, width = 0, height = 0, dpr = 1, previous = performance.now()
    let cells: { x: number; y: number; seed: number }[] = []
    let pitch = 12
    // Full-bleed square-dot atmosphere, inspired by CPA's left-hand brand panel.
    // A local wave field keeps the original SuperAgent palette and needs no external assets.
    const paint = () => {
      // Reveal the accepted wordmark on the same visible-time clock as the field.
      // The visual sweep never represents restoration progress or starts execution.
      const progress = reduced || settled ? 1 : Math.max(0, Math.min(1, (animationMs.current - 300) / 1500))
      lockup.current?.style.setProperty('--logo-reveal', `${progress * 100}%`)
      lockup.current?.style.setProperty('--logo-scan-x', `${progress * 100 - 5}%`)
      lockup.current?.style.setProperty('--logo-scan-opacity', !reduced && progress > 0 && progress < 1 ? '1' : '0')
      const time = reduced ? 4 : animationMs.current / 1000
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#bcbcbc'
      const diagonal = Math.hypot(width, height) || 1
      for (const cell of cells) {
        const x = cell.x / pitch, y = cell.y / pitch
        const field = Math.sin(x * .15 + time * .24) * Math.cos(y * .13 - time * .16)
          + Math.sin(x * .07 + y * .11 - time * .2) * .65
          + Math.cos(x * .31 - y * .23 + time * .12) * .25
        const density = Math.max(0, Math.min(1, (field + .45) * .58))
        const reveal = reduced ? 1 : Math.max(0, Math.min(1, (time - Math.hypot(cell.x - width, cell.y - height) / diagonal * .85) / .65))
        const alpha = cell.seed < density ? (.16 + density * .22) : .018
        context.globalAlpha = alpha * reveal
        context.fillRect(cell.x, cell.y, Math.round(pitch * .52), Math.round(pitch * .52))
      }
      context.globalAlpha = 1
    }
    const draw = (now: number) => {
      if (now - previous >= 1000 / 30) {
        animationMs.current += Math.min(now - previous, 100)
        previous = now
        paint()
      }
      frame = requestAnimationFrame(draw)
    }
    const resize = () => {
      const rect = surface.getBoundingClientRect()
      width = rect.width; height = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2)
      surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr)
      // Bound point count on large displays while maintaining crisp square pixels.
      pitch = Math.max(10, Math.round(Math.sqrt(width * height / 6500)))
      cells = []
      for (let y = 0, row = 0; y < height; y += pitch, row++) for (let x = 0, col = 0; x < width; x += pitch, col++) {
        const noise = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
        cells.push({ x: x + (pitch - Math.round(pitch * .52)) / 2, y: y + (pitch - Math.round(pitch * .52)) / 2, seed: noise - Math.floor(noise) })
      }
      paint()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(surface)
    if (!reduced && !settled) frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [running, reduced, settled])

  return <div className={styles.startup} data-superagent-startup="" data-settled={settled} data-active={running} aria-busy={!ready}>
    <canvas ref={canvas} className={styles.field} aria-hidden="true" />
    <div className={styles.identity}>
      <div className={styles.overline}>{t('startup.eyebrow')}</div>
      <h1 ref={lockup} className={styles.name} aria-label="JanusX">
        <img className={styles.logoGhost} src={wordmark} alt="" aria-hidden="true" />
        <img className={styles.logoFace} data-startup-wordmark="" src={wordmark} alt="" aria-hidden="true" />
        <span className={styles.logoScan} style={{ maskImage: `url(${JSON.stringify(wordmark)})` }} aria-hidden="true" />
      </h1>
      <p className={styles.subtitle}>{t('startup.tagline')}</p>
      <p className={styles.status} role="status">{t(ready ? 'startup.ready' : 'startup.preparing')}</p>
      <div className={styles.track} aria-hidden="true"><span /></div>
    </div>
  </div>
}
