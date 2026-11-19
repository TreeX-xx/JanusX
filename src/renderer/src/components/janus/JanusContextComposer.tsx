import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ConversationContext } from '../ConversationContext'
import type { ConversationInputHandle } from '../ConversationInput'
import type { ConversationReference } from '../../../../shared/conversation-context'

/** Same importer, file picker and inline-reference editor as the native conversation mode. */
export function JanusContextComposer({ context, inputRef, references, draft, setDraft, onImporting, pickerActive, children }: {
  context?: { id: string; workspacePath?: string }
  inputRef: RefObject<ConversationInputHandle>
  references: ConversationReference[]; draft: string; setDraft(value: string): void
  onImporting(value: boolean): void; pickerActive: boolean
  children(control?: ReactNode): ReactNode
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (pickerActive) setOpen(false) }, [pickerActive])
  if (!context) return children()
  return <ConversationContext inputRef={inputRef} terminalId={context.id} workspacePath={context.workspacePath} references={references}
    draft={draft} setDraft={setDraft} disabled={false} onImporting={onImporting} open={open && !pickerActive} onOpenChange={setOpen} pickerActive={pickerActive}>
    {children}
  </ConversationContext>
}
