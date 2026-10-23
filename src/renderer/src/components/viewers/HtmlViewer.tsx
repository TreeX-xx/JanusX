import { readFileViewState, saveFileViewState } from '@/lib/file-view-state'
import { useState, useCallback, useRef, useEffect } from 'react'
import { PreviewModeToggle, type PreviewMode } from './PreviewModeToggle'
import { MonacoViewer } from './MonacoViewer'
import { ViewerToolbar } from './ViewerToolbar'
import { HtmlPreviewFrame } from './HtmlPreviewFrame'
import type { FindableEditor } from '@/lib/editor-find'
import { useI18n } from '@/i18n/useI18n'

interface HtmlViewerProps {
  content: string
  originalContent?: string
  onChange: (value: string) => void
  onEditorMount?: (editor: FindableEditor | null) => void
  modelPath?: string
  workspacePath?: string
  documentPath?: string
}

export function HtmlViewer({ content, originalContent, onChange, onEditorMount, modelPath, workspacePath, documentPath }: HtmlViewerProps) {
  const { t } = useI18n('editor')
  const [controlsTarget, setControlsTarget] = useState<HTMLSpanElement | null>(null)
  const [splitRatio, setSplitRatio] = useState(50)
  const [scriptsEnabled, setScriptsEnabled] = useState(true)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => readFileViewState(modelPath).previewMode ?? 'preview')
  const [previewContent, setPreviewContent] = useState(content)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      setPreviewContent(content)
    }, 300)
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [content])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = (x / rect.width) * 100
      setSplitRatio(Math.max(20, Math.min(80, pct)))
    }

    const handleMouseUp = () => {
      isDragging.current = false
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const toggleScripts = useCallback(() => {
    setScriptsEnabled((v) => !v)
  }, [])

  const showEditor = previewMode !== 'preview'
  const showPreview = previewMode !== 'editor'
  const isSplit = previewMode === 'split'

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style={{ background: 'var(--shell-void)' }}>
      <ViewerToolbar>
        <PreviewModeToggle value={previewMode} onChange={mode => { setPreviewMode(mode); saveFileViewState(modelPath, { previewMode: mode }) }} />
        {showPreview && <span ref={setControlsTarget} className="viewer-preview-controls" />}
      </ViewerToolbar>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showEditor && <div aria-label={t('editor:previewMode.code')} className="min-w-0 overflow-hidden" style={{ width: isSplit ? splitRatio + '%' : '100%' }}>
          <MonacoViewer content={content} language="html" originalContent={originalContent} modelPath={modelPath}
            onChange={onChange} onEditorMount={onEditorMount} />
        </div>}
        {isSplit && <div className="viewer-divider shrink-0 h-full" style={{ width: 3, cursor: 'col-resize', background: 'var(--shell-border-soft)' }} onMouseDown={handleDividerMouseDown} />}
        {showPreview && <div aria-label={t('editor:previewMode.preview')} className="min-w-0 overflow-hidden" style={{ width: isSplit ? (100 - splitRatio) + '%' : '100%' }}>
          <HtmlPreviewFrame content={previewContent} workspacePath={workspacePath} documentPath={documentPath ?? modelPath}
            scriptsEnabled={scriptsEnabled} onToggleScripts={toggleScripts} controlsTarget={controlsTarget} />
        </div>}
      </div>
    </div>
  )
}
