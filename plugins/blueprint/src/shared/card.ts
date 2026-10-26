import type { BlueprintNodeStatus, BlueprintNodeType } from './janus/types'
import type { NoteStatusPart } from './blueprint-note-status'
export interface BlueprintNodeData extends Record<string, unknown> {
  title: string
  status: BlueprintNodeStatus
  nodeType: BlueprintNodeType
  /** note 原始 kind（harness 透传；缺省时 kindtag 按 type 回退） */
  kind?: string | null
  moduleState?: string
  noteStatus?: NoteStatusPart[]
  reviewRoot?: string
  noteId?: string
  progress: number
  workspaceName: string | null
  boundTerminalId: string | null
  childCount?: number
  collapsed?: boolean
  childSummary?: string
  issueSummary?: string
  blockedReason?: string
  analysisSummary?: string
  collapsedSummary?: string
  searchMatched?: boolean
  searchDimmed?: boolean
}
