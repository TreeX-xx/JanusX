// Note: .agents/notes/workbench/file-editor-experience.md — read-only PDF preview.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
// Electron 35 requires the compatibility build, including the worker polyfills.
import { AnnotationMode, getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFViewer as Viewer } from 'pdfjs-dist/types/web/pdf_viewer'
import type { OpenFile } from '../../../../shared/editor'
import { useEditorStore } from '@/stores/editor'
import { ViewerToolbar } from './ViewerToolbar'
import 'pdfjs-dist/web/pdf_viewer.css'
import './pdf-viewer.css'

GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfViewer({ file }: { file: OpenFile }) {
  const { t } = useTranslation('editor')
  const container = useRef<HTMLDivElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer>()
  const initial = useRef(file.viewState)
  const [page, setPage] = useState(1)
  const [count, setCount] = useState(0)
  const [scale, setScale] = useState('page-width')
  const [error, setError] = useState(false)
  const [passwordState, setPasswordState] = useState<'required' | 'incorrect' | null>(null)
  const [password, setPassword] = useState('')
  const unlock = useRef<(password: string) => void>()
  useEffect(() => { initial.current = file.viewState }, [file.viewState])

  useEffect(() => {
    const restored = initial.current
    let disposed = false
    let loading: ReturnType<typeof getDocument> | undefined
    let resize: ResizeObserver | undefined
    let instance: Viewer | undefined
    setCount(0); setError(false); setPasswordState(null)
    const save = () => {
      if (!disposed && instance?.pdfDocument) useEditorStore.getState().updateViewState(file.id, {
        pdfPage: instance.currentPageNumber, pdfScale: instance.currentScaleValue,
      })
    }
    void (async () => {
      // The viewer component consumes the core library initialized above.
      const { EventBus, PDFViewer } = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
      if (disposed) return
      const eventBus = new EventBus()
      instance = new PDFViewer({ container: container.current!, viewer: pages.current!, eventBus,
        annotationMode: AnnotationMode.DISABLE, maxCanvasPixels: 8 * 1024 * 1024 })
      viewer.current = instance
      eventBus.on('pagesinit', () => {
        if (disposed || !instance) return
        instance.currentScaleValue = restored?.pdfScale ?? 'page-width'
        instance.currentPageNumber = Math.min(instance.pagesCount, Math.max(1, restored?.pdfPage ?? 1))
        setCount(instance.pagesCount); setPage(instance.currentPageNumber); setScale(instance.currentScaleValue)
      })
      eventBus.on('pagechanging', () => { if (!disposed && instance) { setPage(instance.currentPageNumber); save() } })
      eventBus.on('scalechanging', () => { if (!disposed && instance) { setScale(instance.currentScaleValue); save() } })
      eventBus.on('pagerendered', (event: { error?: unknown }) => { if (!disposed && event.error) setError(true) })
      const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href
      const data = Uint8Array.from(atob(file.base64 ?? ''), char => char.charCodeAt(0))
      loading = getDocument({ data, cMapUrl: assets + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/' })
      loading.onPassword = (callback: (password: string) => void, reason: number) => {
        if (disposed) return
        unlock.current = callback
        setPasswordState(reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required')
      }
      const pdf = await loading.promise
      if (disposed) return
      instance.setDocument(pdf)
      resize = new ResizeObserver(() => {
        if (instance?.pdfDocument) {
          const value = instance.currentScaleValue
          if (value === 'page-width' || value === 'page-fit') instance.currentScaleValue = value
          instance.update()
        }
      })
      resize.observe(container.current!)
    })().catch(cause => { if (!disposed) { console.warn('PDF preview failed', cause); setError(true); setPasswordState(null) } })
    return () => {
      disposed = true; unlock.current = undefined; resize?.disconnect()
      instance?.setDocument(null!); viewer.current = undefined
      void loading?.destroy().catch(() => {})
    }
  }, [file.id, file.base64])

  const go = (value: number) => { if (viewer.current && Number.isInteger(value) && value >= 1 && value <= count) viewer.current.currentPageNumber = value }
  const zoom = (value: string) => { if (viewer.current) viewer.current.currentScaleValue = value }
  return <div className="pdf-preview">
    <ViewerToolbar>
      <div className="pdf-controls">
      <button type="button" title={t('pdf.previous')} aria-label={t('pdf.previous')} disabled={!count || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={16} /></button>
      <input className="pdf-page-number" aria-label={t('pdf.page')} type="number" min={1} max={count || 1} value={page} disabled={!count} onChange={event => go(Number(event.target.value))} />
      <span>/ {count}</span>
      <button type="button" title={t('pdf.next')} aria-label={t('pdf.next')} disabled={!count || page >= count} onClick={() => go(page + 1)}><ChevronRight size={16} /></button>
      <button type="button" title={t('pdf.zoomOut')} aria-label={t('pdf.zoomOut')} disabled={!count} onClick={() => zoom(String(Math.max(.25, (viewer.current?.currentScale ?? 1) / 1.2)))}><Minus size={16} /></button>
      <select aria-label={t('pdf.zoom')} value={scale} disabled={!count} onChange={event => zoom(event.target.value)}>
        <option value="page-width">{t('pdf.fitWidth')}</option><option value="page-fit">{t('pdf.fitPage')}</option>
        {['0.5', '1', '1.5', '2', ...(Number.isFinite(Number(scale)) && !['0.5', '1', '1.5', '2'].includes(scale) ? [scale] : [])].map(value => <option key={value} value={value}>{Math.round(Number(value) * 100)}%</option>)}
      </select>
      <button type="button" title={t('pdf.zoomIn')} aria-label={t('pdf.zoomIn')} disabled={!count} onClick={() => zoom(String(Math.min(4, (viewer.current?.currentScale ?? 1) * 1.2)))}><Plus size={16} /></button>
      </div>
    </ViewerToolbar>
    <div className="pdf-stage">
      <div ref={container} className="pdf-scroll" tabIndex={0} aria-label={t('pdf.document')}><div ref={pages} className="pdfViewer" /></div>
      {error ? <div className="pdf-message" role="alert">{t('pdf.error')}</div> : passwordState ? <form className="pdf-message" onSubmit={event => {
        event.preventDefault(); unlock.current?.(password); setPassword(''); setPasswordState(null)
      }}>
        <label>{t(passwordState === 'incorrect' ? 'pdf.incorrectPassword' : 'pdf.password')}<input autoFocus aria-label={t('pdf.password')} type="password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit">{t('pdf.unlock')}</button>
      </form> : !count && <div className="pdf-message" role="status">{t('pdf.loading')}</div>}
    </div>
  </div>
}
