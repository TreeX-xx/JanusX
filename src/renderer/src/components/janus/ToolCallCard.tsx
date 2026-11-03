/**
 * @file 工具调用卡片 —— 内联到消息流，替代原顶部孤立 activity chip。
 * @description 一张卡片对应一条 ChatToolTraceEntry。卡片可折叠/展开，
 *              显示状态图标、工具名、参数摘要、结果摘要、错误详情、耗时。
 *              流式期间正在执行的工具也用本卡片渲染（status === 'running'|'requested'|'approval'）。
 */

import { useState, useCallback } from 'react'
import { useHistoryDisclosure } from '../chat/VirtualHistory'
import { Check, ChevronDown, ChevronRight, CircleX, Clock, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ChatToolTraceEntry } from '../../../../shared/ipc/llm'
import { useI18n } from '@/i18n/useI18n'

export interface ToolCallCardProps {
  entry: ChatToolTraceEntry
  /** 已附加工作区名表，用于把 workspaceId 解析为可读名。 */
  workspaceNames: Map<string, string>
  /** 卡片初始是否展开；实时和历史调用均默认收起详情。 */
  defaultExpanded?: boolean
}

function statusIcon(entry: ChatToolTraceEntry, statusLabels: { requested: string; approval: string; running: string; completed: string; failed: string; cancelled: string }) {
  switch (entry.status) {
    case 'approval':
      return <ShieldAlert size={12} className="janus-tool-card-icon janus-tool-card-icon--approval" aria-label={statusLabels.approval} />
    case 'requested':
    case 'running':
      return <LoaderCircle size={12} className="janus-tool-card-icon janus-tool-card-icon--running" aria-label={statusLabels.running} />
    case 'completed':
      return <ShieldCheck size={12} className="janus-tool-card-icon janus-tool-card-icon--completed" aria-label={statusLabels.completed} />
    case 'failed':
    case 'denied':
      return <CircleX size={12} className="janus-tool-card-icon janus-tool-card-icon--failed" aria-label={statusLabels.failed} />
    case 'cancelled':
      return <CircleX size={12} className="janus-tool-card-icon janus-tool-card-icon--cancelled" aria-label={statusLabels.cancelled} />
    default:
      return <Check size={12} className="janus-tool-card-icon" aria-label={statusLabels.completed} />
  }
}

function formatDuration(entry: ChatToolTraceEntry): number | null {
  if (typeof entry.startedAt !== 'number') return null
  const end = typeof entry.completedAt === 'number' ? entry.completedAt : Date.now()
  const ms = Math.max(0, end - entry.startedAt)
  return ms < 100 ? null : ms
}

export function ToolCallCard({ entry, workspaceNames, defaultExpanded = false }: ToolCallCardProps) {
  const { t } = useI18n('janus')
  const [expanded, setExpanded] = useHistoryDisclosure(`tool:${entry.callId}`, defaultExpanded)
  const [copied, setCopied] = useState(false)
  const statusLabels = {
    requested: t('janus:chat.tool.status.requested'),
    approval: t('janus:chat.tool.status.approval'),
    running: t('janus:chat.tool.status.running'),
    completed: t('janus:chat.tool.status.completed'),
    failed: t('janus:chat.tool.status.failed'),
    cancelled: t('janus:chat.tool.status.cancelled'),
    denied: t('janus:chat.timeline.denied'),
  }
  const hasDetail = Boolean(entry.argsDigest || entry.resultDigest || entry.errorDetail)
  const duration = formatDuration(entry)
  const workspaceName = workspaceNames.get(entry.workspaceId)
  const Icon = expanded ? ChevronDown : ChevronRight
  const statusKey = entry.status in statusLabels ? (entry.status as keyof typeof statusLabels) : 'completed'

  const handleCopy = useCallback(() => {
    const text = [entry.toolName, entry.workspaceId, entry.status, entry.summary].filter(Boolean).join(' · ')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }, [entry])

  return (
    <div className={`janus-tool-card janus-tool-card--${entry.status}`} data-turn={entry.turnId ?? ''} data-call-id={entry.callId}>
      <div className="janus-tool-card-head">
        <button
          type="button"
          className="janus-tool-card-toggle"
          onClick={() => setExpanded((open) => !open)}
          disabled={!hasDetail}
          aria-expanded={expanded}
          aria-label={expanded ? t('janus:chat.tool.collapseTitle') : t('janus:chat.tool.expandTitle')}
          title={hasDetail ? (expanded ? t('janus:chat.tool.collapseTitle') : t('janus:chat.tool.expandTitle')) : undefined}
        >
          {hasDetail ? <Icon size={11} aria-hidden="true" /> : <span className="janus-tool-card-toggle-spacer" />}
        </button>
        {statusIcon(entry, statusLabels)}
        <span className="janus-tool-card-name" title={entry.toolName}>{entry.toolName}</span>
        {workspaceName && (
          <span className="janus-tool-card-workspace">{t('janus:chat.tool.workspaceAt', { name: workspaceName })}</span>
        )}
        <span className={`janus-tool-card-status janus-tool-card-status--${entry.status}`}>{statusLabels[statusKey]}</span>
        {duration !== null && (
          <span className="janus-tool-card-duration" title={t('janus:chat.tool.duration', { ms: duration })}>
            <Clock size={10} aria-hidden="true" />
            <span>{t('janus:chat.tool.duration', { ms: duration })}</span>
          </span>
        )}
        <button
          type="button"
          className="janus-tool-card-copy"
          onClick={handleCopy}
          title={t('janus:chat.tool.copySummaryTitle')}
          aria-label={t('janus:chat.tool.copySummaryAria')}
        >
          {copied ? t('janus:chat.tool.copied') : ''}
        </button>
      </div>
      {entry.summary && <p className="janus-tool-card-summary">{entry.summary}</p>}
      {expanded && hasDetail && (
        <div className="janus-tool-card-body">
          {entry.argsDigest && (
            <div className="janus-tool-card-section">
              <strong className="janus-tool-card-section-label">{t('janus:chat.tool.argsLabel')}</strong>
              <code className="janus-tool-card-code">{entry.argsDigest}</code>
            </div>
          )}
          {entry.resultDigest && (
            <div className="janus-tool-card-section">
              <strong className="janus-tool-card-section-label">{t('janus:chat.tool.resultLabel')}</strong>
              <code className="janus-tool-card-code">{entry.resultDigest}</code>
            </div>
          )}
          {entry.errorDetail && entry.status !== 'completed' && (
            <div className="janus-tool-card-section janus-tool-card-section--error">
              <strong className="janus-tool-card-section-label">{t('janus:chat.tool.errorLabel')}</strong>
              <pre className="janus-tool-card-error">{entry.errorDetail}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
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
  const [groupExpanded, setGroupExpanded] = useHistoryDisclosure(`tools:${entries[0]?.callId}`, defaultExpanded)
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
