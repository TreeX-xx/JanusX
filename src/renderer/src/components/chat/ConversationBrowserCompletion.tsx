import { Globe } from 'lucide-react'
import type { ConversationEngine, ConversationItem } from '../../../../shared/conversation-display'
import styles from '../AgentSessionPane.module.css'

const prefix = '::browser-complete{title="'
const marker = /^::browser-complete\{title=("(?:[^"\\\r\n]|\\.)*")\}$/

type BrowserCompletion = { state: 'streaming' } | { state: 'completed'; title: string }

// Browser completion in the Codex output stream: .agents/notes/workbench/terminal-dialog-dual-mode.md
export function codexBrowserCompletion(item: ConversationItem | undefined, engine: ConversationEngine): BrowserCompletion | undefined {
  if (engine !== 'codex' || item?.type !== 'agentMessage' || item.phase !== 'commentary' || item.truncated) return
  const text = item.text.trimEnd()
  if (item.status === 'inProgress' && !/[\r\n]/.test(text) && (prefix.startsWith(text) || text.startsWith(prefix))) {
    return { state: 'streaming' }
  }
  if (item.status !== 'completed' || !text.startsWith(prefix)) return
  const match = marker.exec(text)
  if (!match) return
  try {
    const title: string = JSON.parse(match[1]).trim()
    if (title && !/[\r\n]/.test(title)) return { state: 'completed', title }
  } catch {
    // Malformed markers remain regular message text.
  }
}

export function ConversationBrowserCompletion({ title }: { title: string }) {
  return <p className={styles.browserCompletion} data-browser-completion="" role="status">
    <Globe size={14} aria-hidden="true" /><span>{title}</span>
  </p>
}
