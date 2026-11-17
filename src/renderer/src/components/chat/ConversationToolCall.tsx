import { FileCode2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationItem } from '../../../../shared/conversation-display'
import { ToolDisclosure } from './ToolDisclosure'
import styles from '../AgentSessionPane.module.css'

/** Native adapters retain file navigation/diffs; the tool row is shared with JanusX. */
export function ConversationToolCall({ item, openFile }: { item: ConversationItem; openFile: (path: string) => void }) {
  const { t } = useTranslation('terminal')
  return <ToolDisclosure stateKey={item.id} kind={item.type} status={item.status}
    statusLabel={t(`conversation.state.${item.status}`, { defaultValue: item.status })}
    target={item.activity || (item.files?.length ? item.files.map(file => file.path).join(', ') : item.text.split('\n')[0])}
    startedAt={item.receivedAt} durationMs={item.durationMs}>
    {() => <>
      {item.text && <pre>{item.text}</pre>}
      {item.files?.map(file => <div className={styles.file} key={file.path}>
        <button type="button" onClick={() => openFile(file.path)} aria-label={file.path} title={`${t('conversation.openFile')} · ${file.path}`}>
          <FileCode2 size={15} aria-hidden="true" /><span>{file.path.split(/[\\/]/).pop()}</span><span className={styles.filePath}>{file.path}</span>
        </button>
        <pre className={styles.diff}>{file.diff.split('\n').map((line, index) => <span key={index} data-change={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'delete' : undefined}>{line}{'\n'}</span>)}</pre>
      </div>)}
      {item.truncated && <p>{t('conversation.truncated')}</p>}
    </>}
  </ToolDisclosure>
}
