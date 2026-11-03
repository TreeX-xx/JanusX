import { LazyDetails } from './chat/VirtualHistory'
import { useState } from 'react'
import { ChevronRight, FileCode2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationChangedFile } from '../../../shared/conversation-file-changes'
import { DiffCounts } from './shared/DiffCounts'
import styles from './AgentSessionPane.module.css'

export function ConversationFileChanges({ turnId, files, incomplete, openFile, onFeedback, onReview }: {
  onReview?: () => void
  onFeedback?: (path: string, quote: string) => void
  turnId: string; files: ConversationChangedFile[]; incomplete: boolean; openFile: (path: string) => Promise<void>
}) {
  const [selection, setSelection] = useState<{ path: string; text: string } | null>(null)
  const { t } = useTranslation('terminal')
  const countsKnown = files.every(file => file.countsKnown) && !incomplete
  return <LazyDetails stateKey="files" className={styles.turnFiles} data-turn-files={turnId} summary={
    <summary><ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
      <span>{t('conversation.changedFiles', { count: files.length })}</span>
      {countsKnown && <DiffCounts additions={files.reduce((sum, file) => sum + file.additions, 0)} deletions={files.reduce((sum, file) => sum + file.deletions, 0)} />}
      <span className={styles.turnFilesAction}>{t('conversation.viewChanges')}</span>
    </summary>}>{() => <>
    <p className={styles.notice}>{t('conversation.changeScope')}</p>
    {onReview && <button type="button" onClick={onReview}>{t('conversation.feedback.review')}</button>}
    {incomplete && <p className={styles.notice} role="status">{t('conversation.truncated')}</p>}
    {files.map(file => <LazyDetails stateKey={file.path} className={`${styles.file} ${styles.turnFile}`} key={file.path} summary={
      <summary>
        <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
        <FileCode2 size={15} aria-hidden="true" /><span className={styles.turnFilePath}>{file.path}</span>
        {file.countsKnown && <DiffCounts additions={file.additions} deletions={file.deletions} />}
      </summary>}>{() => <>
      <button type="button" onClick={() => void openFile(file.path)} aria-label={file.path} title={`${t('conversation.openFile')} · ${file.path}`}>{t('conversation.openFile')}</button>
      {onFeedback && <div className={styles.feedbackActions}>
        <button type="button" onClick={() => onFeedback(file.path, '')}>{t('conversation.feedback.file')}</button>
        {selection?.path === file.path && <button type="button" onClick={() => { onFeedback(file.path, selection.text); setSelection(null) }}>{t('conversation.feedback.selection')}</button>}
      </div>}
      {file.patches.map((patch, index) => patch ? <pre className={styles.diff} key={index} onMouseUp={event => {
        const selected = window.getSelection()
        if (selected?.rangeCount && event.currentTarget.contains(selected.getRangeAt(0).commonAncestorContainer)) {
          const text = selected.toString(); setSelection(text ? { path: file.path, text } : null)
        }
      }}>{patch.split('\n').map((line, lineIndex) => <span key={lineIndex} data-change={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'delete' : undefined}>{onFeedback && <button type="button" className={styles.diffFeedback} aria-label={t('conversation.feedback.line', { line: lineIndex + 1 })} title={t('conversation.feedback.line', { line: lineIndex + 1 })} onClick={() => onFeedback(file.path, `Patch ${index + 1}, row ${lineIndex + 1}:\n${line}`)}>+</button>}{line}{'\n'}</span>)}</pre> : <p className={styles.notice} key={index}>{t('conversation.diffUnavailable')}</p>)}
    </>}</LazyDetails>)}
  </>}</LazyDetails>
}
