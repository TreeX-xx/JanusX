import type { MarkdownView, ParsedNote } from '@janus-agent/harness-core'

export type NoteSource = { note: ParsedNote; raw: string; relPath: string; sha256: string; matchesSnapshot: boolean; view: MarkdownView }
export type NoteBodySource = { uri: string; body: string; view: MarkdownView }
export function noteBody(source: NoteSource, uri: string): NoteBodySource {
  return { uri, body: source.note.body, view: source.view }
}
