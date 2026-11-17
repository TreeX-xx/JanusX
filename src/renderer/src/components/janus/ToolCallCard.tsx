/** Janus tool data adapter. Tool rows and detail surfaces match native conversations. */
import { useState, useCallback } from 'react'
import { useWorkDisclosure } from '../chat/WorkDisclosure'
import { ToolDisclosure } from '../chat/ToolDisclosure'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import type { ChatToolTraceEntry } from '../../../../shared/ipc/llm'
import { useI18n } from '@/i18n/useI18n'

export interface ToolCallCardProps {
  entry: ChatToolTraceEntry
  workspaceNames: Map<string, string>
  defaultExpanded?: boolean
}

export function ToolCallCard({ entry, workspaceNames, defaultExpanded = false }: ToolCallCardProps) {
  const { t } = useI18n('janus')
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    const text = [entry.toolName, entry.workspaceId, entry.status, entry.summary].filter(Boolean).join(' · ')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }, [entry])
  const workspaceName = workspaceNames.get(entry.workspaceId)
  const duration = typeof entry.startedAt === 'number' && typeof entry.completedAt === 'number'
    ? Math.max(0, entry.completedAt - entry.startedAt) : undefined
  return <ToolDisclosure stateKey={`tool:${entry.callId}`} kind={entry.toolName}
    target={entry.argsDigest || entry.summary || entry.toolName} status={entry.status}
    statusLabel={t(entry.status === 'denied' ? 'janus:chat.timeline.denied' : `janus:chat.tool.status.${entry.status}`)}
    startedAt={entry.startedAt} durationMs={duration} defaultExpanded={defaultExpanded}
    className={`janus-tool-card janus-tool-card--${entry.status}`} summaryClassName="janus-tool-card-toggle"
    bodyClassName="janus-tool-card-body" callId={entry.callId} turnId={entry.turnId}>
    {() => <>
      {entry.summary && <p>{entry.summary}</p>}
      {(entry.argsDigest || entry.resultDigest) && <pre aria-label={t(entry.resultDigest ? 'janus:chat.tool.resultLabel' : 'janus:chat.tool.argsLabel')}>
        {[entry.argsDigest, entry.resultDigest].filter(Boolean).join('\n\n')}
      </pre>}
      {entry.errorDetail && entry.status !== 'completed' && <div className="conversation-tool-error">
        <pre aria-label={t('janus:chat.tool.errorLabel')}>{entry.errorDetail}</pre>
      </div>}
      <div className="conversation-tool-meta">
        <span>{entry.toolName}</span>
        {workspaceName && <span>{t('janus:chat.tool.workspaceAt', { name: workspaceName })}</span>}
        <button type="button" onClick={handleCopy} title={t('janus:chat.tool.copySummaryTitle')} aria-label={t('janus:chat.tool.copySummaryAria')}>
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        </button>
      </div>
    </>}
  </ToolDisclosure>
}

export type ToolCallGroupStatus = 'completed' | 'failed' | 'running' | 'approval'

export interface ToolCallGroupSummary {
  total: number
  failed: number
  pending: number
  overall: ToolCallGroupStatus
}

/** 整组聚合摘要（纯函数）：失败优先，其次未完成，最后全完成。 */
export function summarizeToolCallGroup(entries: ChatToolTraceEntry[]): ToolCallGroupSummary {
  let failed = 0
  let pending = 0
  let approval = false
  for (const entry of entries) {
    if (entry.status === 'failed' || entry.status === 'cancelled' || entry.status === 'denied') failed += 1
    else if (entry.status === 'completed') continue
    else {
      pending += 1
      if (entry.status === 'approval') approval = true
    }
  }
  return {
    total: entries.length,
    failed,
    pending,
    overall: failed > 0 ? 'failed' : pending > 0 ? (approval ? 'approval' : 'running') : 'completed',
  }
}

export interface ToolCallGroupProps {
  entries: ChatToolTraceEntry[]
  workspaceNames: Map<string, string>
  /** 显式展开整组和卡片详情（默认 false）。 */
  defaultExpanded?: boolean
  /**
   * 历史回看时整组收起为一行摘要，可展开（默认 false 即平铺）。
   * 收起后展开的是卡片列表，每张卡仍可单独展开看细节。
   */
  collapsible?: boolean
}

export function ToolCallGroup({ entries, workspaceNames, defaultExpanded = false, collapsible = false }: ToolCallGroupProps) {
  const { t } = useI18n('janus')
  const [groupExpanded, setGroupExpanded] = useWorkDisclosure(`tools:${entries[0]?.callId}`, defaultExpanded)
  if (entries.length === 0) return null
  const summary = summarizeToolCallGroup(entries)
  const showCards = !collapsible || groupExpanded
  const Icon = groupExpanded ? ChevronDown : ChevronRight
  return (
    <div className="janus-tool-call-group" role="group" aria-label={t('janus:chat.tool.groupAria')}>
      {collapsible && (
        <button
          type="button"
          className={`janus-tool-call-group-toggle janus-tool-call-group-toggle--${summary.overall}`}
          aria-expanded={groupExpanded}
          title={groupExpanded ? t('janus:chat.tool.collapseTitle') : t('janus:chat.tool.expandTitle')}
          onClick={() => setGroupExpanded((open) => !open)}
        >
          <Icon size={11} aria-hidden="true" />
          <span>{t('janus:chat.tool.groupSummary', { n: summary.total })}</span>
          <span className={`janus-tool-card-status janus-tool-card-status--${summary.overall}`}>
            {summary.overall === 'completed'
              ? t('janus:chat.tool.status.completed')
              : summary.overall === 'failed'
                ? t('janus:chat.tool.status.failed')
                : summary.overall === 'approval'
                  ? t('janus:chat.tool.status.approval')
                  : t('janus:chat.tool.status.running')}
          </span>
        </button>
      )}
      {showCards && entries.map((entry, index) => (
        <ToolCallCard
          key={`${entry.toolName}-${entry.turnId ?? ''}-${index}`}
          entry={entry}
          workspaceNames={workspaceNames}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </div>
  )
}
