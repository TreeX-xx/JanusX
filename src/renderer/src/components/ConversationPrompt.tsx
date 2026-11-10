import type { ReactNode } from 'react'
import styles from './ConversationInput.module.css'

// Display contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
// Native history contains the expanded prompt, not the editor's reference IDs.
// Recognize only the quoted path syntax emitted by conversationPrompt; keep the
// original message untouched for copying, editing and delivery reconciliation.
export function ConversationPrompt({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const pattern = /\b(file|directory|image|diff): ("(?:[^"\\\r\n]|\\.)*")/g
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    let path: string
    try { path = JSON.parse(match[2]) as string } catch { continue }
    // Paths produced by the context picker/importer are absolute. Leave prose
    // examples such as `file: "example"` readable as written.
    if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path)) continue
    parts.push(text.slice(offset, match.index))
    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
    parts.push(<span key={match.index} className={`${styles.reference} ${styles.promptReference}`} title={path} data-prompt-reference={match[1]}><span>{name}</span></span>)
    offset = match.index! + match[0].length
  }
  parts.push(text.slice(offset))
  return <>{parts}</>
}
