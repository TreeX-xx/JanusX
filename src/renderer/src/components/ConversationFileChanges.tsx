import { DisclosureState, LazyDetails } from './chat/VirtualHistory'
import { useContext, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, ExternalLink, FileCode2, FileDiff, Info, MessageSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationChangedFile } from '../../../shared/conversation-file-changes'
import { ThemedTooltip } from './ui/ThemedTooltip'
import { DiffCounts } from './shared/DiffCounts'
import styles from './AgentSessionPane.module.css'

interface TurnFiles {
  turnId: string
  files: ConversationChangedFile[]
  incomplete: boolean
}

interface FilesSelection {
  turnId: string
  transcript: HTMLElement | null
  disclosures: Map<string, boolean>
}

export function useTurnFilesPanel() {
  const id = useId()
  const [selection, select] = useState<FilesSelection | null>(null)
  function close() {
    if (selection?.transcript) {
      // The originating virtual row may have been recycled while the panel was open.
      const trigger = selection.transcript.querySelector<HTMLButtonElement>(`[data-turn-files="${CSS.escape(selection.turnId)}"]`)
      const target = trigger ?? selection.transcript
      target.focus({ preventScroll: true })
    }
    select(null)
  }
  return { id, selection, select, close }
}

type FilesPanel = ReturnType<typeof useTurnFilesPanel>

export function ConversationFileChanges({ turnId, files, incomplete, panel }: TurnFiles & { panel: FilesPanel }) {
  const { t } = useTranslation('terminal')
  const rowDisclosures = useContext(DisclosureState)
  const open = panel.selection?.turnId === turnId
  const countsKnown = !incomplete && files.every(file => file.countsKnown)
  function openReview(button: HTMLButtonElement) {
    if (!files.length) return
    panel.select({ turnId, transcript: button.closest('[role="region"]'), disclosures: rowDisclosures ?? new Map() })
  }
  return <ThemedTooltip variant="panel" disabled={open} label={<div className={styles.turnFilesPreview}>
    {files.slice(0, 3).map(file => <span key={file.path}>{file.path}</span>)}
    {files.length > 3 && <span>+{files.length - 3}</span>}
  </div>}>
    <button type="button" data-turn-files={turnId} className={styles.turnFiles}
      aria-expanded={open} aria-controls={open ? panel.id : undefined}
      onClick={event => open ? panel.close() : openReview(event.currentTarget)}>
      <FileDiff size={14} aria-hidden="true" /><span>{t('conversation.changedFiles', { count: files.length })}</span>
      {countsKnown && <DiffCounts additions={files.reduce((sum, file) => sum + file.additions, 0)} deletions={files.reduce((sum, file) => sum + file.deletions, 0)} />}
      <span className={styles.turnFilesAction}>{t('conversation.viewChanges')}<ChevronRight size={13} aria-hidden="true" /></span>
    </button>
  </ThemedTooltip>
}

export function ConversationFileChangesPanel({ turnId, files, incomplete, panel, openFile, onFeedback, onReview }: TurnFiles & {
  panel: FilesPanel
  openFile: (path: string) => Promise<void>
  onReview?: () => void
  onFeedback?: (path: string, quote: string) => void
}) {
  const [selection, setSelection] = useState<{ path: string; text: string } | null>(null)
  const { t } = useTranslation('terminal')
  const closeButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { closeButton.current?.focus({ preventScroll: true }) }, [turnId])
  const label = t('conversation.changedFiles', { count: files.length })
  return <aside id={panel.id} aria-label={label} data-turn-files-panel={turnId} className={styles.turnFilesPanel}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); panel.close() } }}>
    <header className={styles.turnFilesHeader}><FileDiff size={16} aria-hidden="true" /><strong>{label}</strong>
      <ThemedTooltip label={t('conversation.changeScope')} openOnClick>
        <button type="button" aria-label={t('conversation.changeScope')}><Info size={14} aria-hidden="true" /></button>
      </ThemedTooltip>
      <button type="button" ref={closeButton} onClick={panel.close} aria-label={t('common:action.close')}><X size={16} /></button>
    </header>
    <div className={styles.turnFilesBody}>
      {incomplete && <p className={styles.notice} role="status">{t('conversation.truncated')}</p>}
      <DisclosureState.Provider value={panel.selection?.disclosures ?? null}>
        {files.map(file => <LazyDetails stateKey={file.path} className={`${styles.file} ${styles.turnFile}`} key={file.path} summary={
          <summary>
            <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
            <FileCode2 size={15} aria-hidden="true" /><span className={styles.turnFilePath} title={file.path}>
              <span className={styles.turnFileName}>{file.path.split(/[\\/]/).pop()}</span>
              {/[\\/]/.test(file.path) && <span className={styles.turnFileDirectory}>{file.path}</span>}
            </span>
            {file.countsKnown && <DiffCounts additions={file.additions} deletions={file.deletions} />}
          </summary>}>{() => <>
          {file.patches.map((patch, index) => patch ? <pre className={styles.diff} data-side-source="diff" data-side-path={file.path} data-side-turn={turnId} key={index} onMouseUp={event => {
            const selected = window.getSelection()
            if (selected?.rangeCount && event.currentTarget.contains(selected.getRangeAt(0).commonAncestorContainer)) {
              const text = selected.toString(); setSelection(text ? { path: file.path, text } : null)
            }
          }}>{patch.split('\n').map((line, lineIndex) => <span key={lineIndex} data-change={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'delete' : undefined}>{onFeedback && <button type="button" className={styles.diffFeedback} aria-label={t('conversation.feedback.line', { line: lineIndex + 1 })} title={t('conversation.feedback.line', { line: lineIndex + 1 })} onClick={() => onFeedback(file.path, `Patch ${index + 1}, row ${lineIndex + 1}:\n${line}`)}>+</button>}{line}{'\n'}</span>)}</pre> : <p className={styles.notice} key={index}>{t('conversation.diffUnavailable')}</p>)}
          <div className={styles.feedbackActions}>
            <button type="button" onClick={() => void openFile(file.path)} aria-label={file.path} title={`${t('conversation.openFile')} · ${file.path}`}><ExternalLink size={12} />{t('conversation.openFile')}</button>
            {onFeedback && <button type="button" onClick={() => onFeedback(file.path, '')}><MessageSquare size={12} />{t('conversation.feedback.file')}</button>}
            {onFeedback && selection?.path === file.path && <button type="button" onClick={() => { onFeedback(file.path, selection.text); setSelection(null) }}>{t('conversation.feedback.selection')}</button>}
          </div>
        </>}</LazyDetails>)}
      </DisclosureState.Provider>
      {onReview && <button type="button" className={styles.turnFilesGit} onClick={onReview}>{t('conversation.feedback.review')}</button>}
    </div>
  </aside>
}
