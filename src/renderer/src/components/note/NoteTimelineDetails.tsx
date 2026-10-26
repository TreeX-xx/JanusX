// Note: process cards reference current business records; rendering never replays writes — see .agents/notes/agent/requirements/chat-work-timeline.md
import type { ChatToolBlock } from '../../../../shared/chat-timeline'
import { useEffect, useState } from 'react'
import { useNoteChatStore } from '@/stores/note-chat'
import { useNoteFocusStore } from '@/stores/note-focus'
import { useI18n } from '@/i18n/useI18n'
import { useEditorStore } from '@/stores/editor'
import type { NoteFocusEvent } from '../../../../shared/note-chat'
import { ChangeCard } from './NoteChatActivity'
import './note-focus.css'

// Note: host chat reads sources without a Blueprint projection — see .agents/notes/planning/blueprint-official-plugin.md
function SourceNotes({ event }: { event: NoteFocusEvent }) {
  const { t } = useI18n('blueprint')
  const [error, setError] = useState('')
  const open = async (uri: string) => {
    setError('')
    try {
      const source = await window.electron.harness.noteRead(event.workspacePath, uri)
      await useEditorStore.getState().openFile(event.workspacePath.replace(/[\\/]$/, '') + '/' + source.relPath, event.workspacePath)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return <div className="bp-note-groups"><section className="bp-note-group"><ul>{event.notes.map(note => <li key={note.uri}>
    <span className={`bp-note-role-${note.role}`}>{t(`blueprint:noteFocus.${note.role}`)}</span>
    <button className="bp-note-title" type="button" onClick={() => void open(note.uri)}>{note.title}</button>
    {note.reason && <p>{note.reason}</p>}
  </li>)}</ul></section>{error && <p role="alert">{error}</p>}</div>
}

export function NoteTimelineDetails({ block }: { block: ChatToolBlock }) {
  const { t } = useI18n(['janus', 'blueprint'])
  const changes = useNoteChatStore(state => state.changes)
  useEffect(() => {
    const missing = block.details?.find(detail => detail.kind === 'note-change' && detail.workspacePath && detail.conversationId
      && !useNoteChatStore.getState().changes.some(change => change.id === detail.id))
    if (missing?.kind !== 'note-change') return
    let active = true
    void window.electron.harness.noteChatChanges(missing.workspacePath!, missing.conversationId!).then(records => {
      if (!active) return
      useNoteChatStore.setState(state => {
        const merged = new Map(state.changes.map(change => [change.id, change]))
        for (const record of records) if (!merged.has(record.id)) merged.set(record.id, record)
        return { changes: [...merged.values()] }
      })
    }).catch(() => undefined)
    return () => { active = false }
  }, [block.details])
  return <>{block.details?.map(detail => {
    if (detail.kind === 'config') return null
    if (detail.kind === 'note-change') {
      const change = changes.find(change => change.id === detail.id)
      return change ? <ChangeCard key={detail.id} change={change} /> : <p key={detail.id} role="status">{t('janus:chat.timeline.changeUnavailable')}</p>
    }
    return <details key={detail.focus.id} className="bp-note-access">
      <summary>{t('blueprint:noteFocus.read')} · {detail.focus.notes.length}</summary>
      <SourceNotes event={detail.focus} />
      <button type="button" onClick={() => {
        const state = useNoteFocusStore.getState()
        const current = state.scopes[detail.focus.conversationId]?.notes ?? []
        state.receive({ ...detail.focus, id: crypto.randomUUID(), mode: 'scope', focus: 'none',
          notes: [...current, ...detail.focus.notes.filter(note => !current.some(item => item.uri === note.uri))] })
      }}>{t('blueprint:noteFocus.addScope')}</button>
    </details>
  })}</>
}
