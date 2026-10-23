import { readFileViewState, saveFileViewState } from '@/lib/file-view-state'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Settings2, Braces } from 'lucide-react'
import { ViewerToolbar } from './ViewerToolbar'
import { ToolbarMenu } from './ToolbarMenu'
import { useI18n } from '@/i18n/useI18n'
import { dirnameOfAbsolutePath } from '@/lib/local-asset-resolver'
import { useResolvedHtmlSrcDoc } from './local-asset'
import { useHtmlPreviewDocument } from './useHtmlPreviewDocument'

interface HtmlPreviewFrameProps {
  content: string
  workspacePath?: string
  documentPath?: string
  scriptsEnabled?: boolean
  title?: string
  controlsTarget?: HTMLElement | null
  onToggleScripts?: () => void
}

export function HtmlPreviewFrame({ content, workspacePath, documentPath, scriptsEnabled = true, title, controlsTarget, onToggleScripts }: HtmlPreviewFrameProps) {
  const { t } = useI18n('editor')
  const [viewport, setViewport] = useState(() => readFileViewState(documentPath).viewport ?? '1280x800')
  const [zoom, setZoom] = useState(() => readFileViewState(documentPath).zoom ?? 'fit')
  const [reload, setReload] = useState(0)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const { url, error, pending } = useHtmlPreviewDocument(content, workspacePath, documentPath)
  const fallback = useResolvedHtmlSrcDoc(url || pending ? '' : content, { workspacePath, documentDir: dirnameOfAbsolutePath(documentPath) })
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => observer.disconnect()
  }, [])
  const responsive = viewport === 'responsive'
  const [width, height] = viewport.split('x').map(Number)
  const scale = responsive ? 1 : zoom === 'fit'
    ? Math.max(0.01, Math.min(1, (size.width - 24) / width, (size.height - 24) / height))
    : Number(zoom) / 100
  const frame = <iframe
    key={`${scriptsEnabled}:${reload}`}
    src={url}
    srcDoc={url ? undefined : fallback}
    sandbox={[url ? 'allow-same-origin' : '', scriptsEnabled ? 'allow-scripts allow-forms allow-modals allow-popups' : ''].filter(Boolean).join(' ')}
    referrerPolicy="same-origin"
    title={title ?? t('editor:htmlViewer.iframeTitle')}
    className="border-0"
    style={responsive
      ? { display: 'block', background: 'var(--preview-paper)', width: '100%', height: '100%' }
      : { position: 'absolute', left: 0, top: 0, width, height, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'var(--preview-paper)' }}
  />
  return <div className="flex h-full min-h-0 min-w-0 flex-col" data-html-preview>
    <ViewerToolbar target={controlsTarget}>
      <button type="button" className="shell-icon-btn viewer-icon viewer-zoom" disabled={responsive}
        aria-label={t('editor:htmlViewer.fitWindow')} title={t('editor:htmlViewer.fitWindow')}
        onClick={() => { setZoom('fit'); saveFileViewState(documentPath, { zoom: 'fit' }) }}>{Math.round(scale * 100)}%</button>
      <button type="button" className="shell-icon-btn viewer-icon" aria-label={t('editor:htmlViewer.reload')} title={t('editor:htmlViewer.reload')}
        onClick={() => setReload(value => value + 1)}><RefreshCw size={15} aria-hidden="true" /></button>
      <ToolbarMenu label={t('editor:htmlViewer.options')} icon={Settings2}>
        <label>{t('editor:htmlViewer.viewport')}
          <select aria-label={t('editor:htmlViewer.viewport')} value={viewport} onChange={event => { setViewport(event.target.value); saveFileViewState(documentPath, { viewport: event.target.value }) }}>
            <option value="responsive">{t('editor:htmlViewer.responsive')}</option>
            {['1280x800', '1440x900', '1920x1080', '390x844'].map(value => <option key={value} value={value}>{value.replace('x', ' × ')}</option>)}
          </select>
        </label>
        <label>{t('editor:htmlViewer.zoom')}
          <select aria-label={t('editor:htmlViewer.zoom')} value={zoom} disabled={responsive} onChange={event => { setZoom(event.target.value); saveFileViewState(documentPath, { zoom: event.target.value }) }}>
            <option value="fit">{t('editor:htmlViewer.fitWindow')} ({Math.round(scale * 100)}%)</option>
            {[50, 75, 100, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
        {onToggleScripts && <button type="button" aria-pressed={scriptsEnabled} onClick={onToggleScripts}>
          <Braces size={15} />{t(scriptsEnabled ? 'editor:htmlViewer.disableScripts' : 'editor:htmlViewer.enableScripts')}
        </button>}
      </ToolbarMenu>
    </ViewerToolbar>
    {error && <div role="status" className="px-2 py-1 text-xs" style={{ color: 'var(--shell-muted)' }}>{t('editor:htmlViewer.resourcesUnavailable')}</div>}
    <div ref={viewportRef} data-html-viewport className="min-h-0 min-w-0 flex-1" style={{ overflow: responsive ? 'hidden' : 'auto', background: 'var(--shell-void)' }}>
      {pending ? <div role="status" className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--shell-muted)' }}>{t('editor:product.startingPreview')}</div> : responsive ? frame : <div style={{ width: Math.max(size.width, Math.ceil(width * scale) + 24), height: Math.max(size.height, Math.ceil(height * scale) + 24), display: 'grid', placeItems: 'center' }}>
        <div style={{ width: Math.ceil(width * scale), height: Math.ceil(height * scale), position: 'relative', overflow: 'hidden', boxShadow: '0 1px 8px var(--preview-shadow)' }}>{frame}</div>
      </div>}
    </div>
  </div>
}
