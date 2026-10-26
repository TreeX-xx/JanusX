/**
 * @file ??????????React Flow node type = 'blueprint'?
 * @description ???? / ???? / ??? / ???????? design ?5.2?
 */

import { createContext, memo, useContext } from 'react'
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react'
import { NOTE_KIND_LABEL_KEY, noteKindOf, getBlueprintStatusVisual } from './blueprintStatus'
import { blueprintText as t } from './blueprint-text'
import { Folder, FileText, ChevronRight } from './WorkbenchIcons'
import './blueprint-disclosure.css'
export const BlueprintCardReviewContext = createContext<Record<string, { suggestions: number; unread?: boolean; awaitingReview?: boolean }>>({})

/** 低于该缩放阈值时卡片进入极简渲染（只保留状态点 + 标题 + 折叠入口） */
const SEMANTIC_ZOOM_THRESHOLD = 0.5

/** 画布注入的卡片交互；脱离画布上下文（如测试）时为 null，卡片隐藏折叠入口 */
export const BlueprintCardActionsContext = createContext<{
  toggleCollapse: (nodeId: string) => void
  moduleBrowsing?: boolean
  architectureRoles?: Record<string, 'project' | 'module'>
  moduleDocuments?: Record<string, string[]>
  moduleChildren?: Record<string, { children: string[] }>
  openModule?: (id: string) => void
  showSuggestions?: (id: string) => void
} | null>(null)

/** ?????????? */
export type { BlueprintNodeData } from '../shared/card'
import type { BlueprintNodeData } from '../shared/card'

/** Blueprint ????? React Flow Node ?? */
export type BlueprintRFNodeType = Node<BlueprintNodeData, 'blueprint'>

// Note: card labels and unread marker — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
function BlueprintNodeCardImpl({ id, data, selected }: NodeProps<BlueprintRFNodeType>) {
  const d = data
  const actions = useContext(BlueprintCardActionsContext)
  const minimal = useStore((s) => s.transform[2] < SEMANTIC_ZOOM_THRESHOLD)
  const visual = getBlueprintStatusVisual(d.status) 
  const progress = Math.max(0, Math.min(100, d.progress ?? 0))
  const childCount = d.childCount ?? 0
  const collapsed = d.collapsed ?? false
  const noteKind = noteKindOf({ kind: d.kind ?? undefined, type: d.nodeType })
  const architectureRole = actions?.architectureRoles?.[id]
  const review = useContext(BlueprintCardReviewContext)[id]
  const suggestionCount = review?.suggestions ?? 0
  const unread = review?.unread
  const awaitingReview = review?.awaitingReview

  return (
    <div
      className={[
        'bp-node-card',
        architectureRole ? 'bp-node-card--module' : 'bp-node-card--document',
        `bp-node-card--type-${d.nodeType}`,
        minimal ? 'bp-node-card--minimal' : '',
        selected ? 'bp-node-card--selected' : '',
        d.searchMatched ? 'bp-node-card--matched' : '',
        d.searchDimmed ? 'bp-node-card--dimmed' : ''
      ].filter(Boolean).join(' ')}
    >
      {/* Note: hierarchy edges use Top/Bottom, relation edges may exit Left/Right — see .agents/notes/2026-09-26-blueprint-edge-partial-refresh--edge-refresh.md */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" id="left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" id="right" position={Position.Right} style={{ opacity: 0 }} />

      <div className="bp-node-card__header">
          {childCount > 0 && actions && !actions.moduleBrowsing ? (
            <button
              type="button"
              className="bp-node-card__collapse nodrag"
              onClick={(e) => { e.stopPropagation(); actions.toggleCollapse(id) }}
              onDoubleClick={(e) => e.stopPropagation()}
              aria-expanded={!collapsed}
              aria-label={collapsed
                ? t('blueprint:nodeCard.expandSubtree', { count: childCount })
                : t('blueprint:nodeCard.collapseSubtree', { count: childCount })}
              title={collapsed
                ? t('blueprint:nodeCard.expandSubtree', { count: childCount })
                : t('blueprint:nodeCard.collapseSubtree', { count: childCount })}
            >
              <ChevronRight className="bp-disclosure-chevron" size={14} aria-hidden="true" />
              <span>{childCount}</span>
            </button>
          ) : null}

        <span className="bp-node-card__symbol" aria-hidden="true">{architectureRole ? <Folder size={17} /> : <FileText size={14} />}</span>
        {d.noteId ? (suggestionCount > 0 || awaitingReview) && <button type="button" onClick={event => { event.stopPropagation(); actions?.showSuggestions?.(id) }} onDoubleClick={event => event.stopPropagation()} className="bp-node-card__dot nodrag" title={t(awaitingReview ? 'blueprint:review.awaitingReview' : 'blueprint:review.pendingCount', { count: suggestionCount })} aria-label={t(awaitingReview ? 'blueprint:review.awaitingReview' : 'blueprint:review.pendingCount', { count: suggestionCount })} style={{ background: awaitingReview ? 'transparent' : 'var(--shell-accent, #b98736)', border: awaitingReview ? '1px solid currentColor' : undefined, color: 'var(--shell-accent, #b98736)' }} />
          : <span className="bp-node-card__dot" style={{ background: architectureRole ? 'var(--shell-muted)' : visual.color, color: architectureRole ? 'var(--shell-muted)' : visual.color }} />}
        <span className="bp-node-card__kindtag">{architectureRole ? t('blueprint:architecture.' + architectureRole) : NOTE_KIND_LABEL_KEY[noteKind] ? t(NOTE_KIND_LABEL_KEY[noteKind]) : noteKind}</span>
        <div className="bp-node-card__actions">
          {architectureRole && <button type="button" className="bp-node-card__enter nodrag" aria-label={t('blueprint:browse.enterModule', { name: d.title })} title={t('blueprint:browse.enterModule', { name: d.title })}
            onClick={event => { event.stopPropagation(); actions?.openModule?.(id) }} onDoubleClick={event => event.stopPropagation()}><ChevronRight size={17} /></button>}
          {unread && <span className="bp-node-card__updated" role="img" aria-label={t('attention.updatedDescription')} title={t('attention.updatedDescription')}>
            <span className="bp-node-card__updated-mark" aria-hidden="true" />
            {!minimal && <span>{t('attention.updated')}</span>}
          </span>}
        </div>
      </div>

      <div className="bp-node-card__title">{d.title || <span className="bp-node-card__title--empty">{t('blueprint:nodeCard.untitled')}</span>}</div>

      {minimal ? null : (
        <>
          {architectureRole && <div className="bp-node-card__contents">{t('blueprint:browse.contents', { documents: actions?.moduleDocuments?.[id]?.length ?? 0, modules: actions?.moduleChildren?.[id]?.children.length ?? 0 })}</div>}
          {!actions?.moduleBrowsing && <div className="bp-node-card__progress">
            <div className="bp-node-card__progress-bar" style={{ width: `${progress}%` }} />
          </div>}

          <div className="bp-node-card__footer">
            <span>{d.noteStatus?.length ? d.noteStatus.map(part => t('blueprint:noteStatus.' + part.key, part.values)).join(' · ') : d.moduleState ? t('blueprint:moduleState.' + d.moduleState) : t(visual.labelKey)}</span>
            {d.boundTerminalId ? (
              <span className="bp-node-card__terminal" title={t('blueprint:nodeCard.terminalAria', { id: d.boundTerminalId })}>
                term
              </span>
            ) : null}
          </div>
          {!actions?.moduleBrowsing && (d.childSummary || d.issueSummary || d.blockedReason || d.analysisSummary || d.collapsedSummary) ? (
            <div className="bp-node-card__signals" aria-label={t('blueprint:nodeCard.signalsAria')}>
              {d.childSummary ? <span>{d.childSummary}</span> : null}
              {d.issueSummary ? <span className="bp-node-card__signal--risk">{d.issueSummary}</span> : null}
              {d.blockedReason ? <span className="bp-node-card__signal--blocked">{t('blueprint:nodeCard.blocked')}</span> : null}
              {d.analysisSummary ? <span className="bp-node-card__signal--analysis">{d.analysisSummary}</span> : null}
              {d.collapsedSummary ? <span className="bp-node-card__signal--collapsed">{d.collapsedSummary}</span> : null}
            </div>
          ) : null}
        </>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" id="left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="right" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

export const BlueprintNodeCard = memo(BlueprintNodeCardImpl)
