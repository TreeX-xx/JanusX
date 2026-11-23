import { hasOpenSuperAgent, useSuperAgentEnabled } from '@/lib/superagent-plugin'
import { useEffect } from 'react'
import { useSuperAgentAvailability } from './useSuperAgentAvailability'
import i18n from '@/i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import { getLeafPanes } from '@/lib/workspace-pane'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { openSuperAgent } from '@/lib/superagent-navigation'
import type { SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'

/** Application-owned subscriptions survive pane collapse, tab closure and workspace navigation. */
export function useSuperAgentNotices() {
  const optedIn = useSuperAgentUIStore(state => state.started)
  const enabled = useSuperAgentEnabled()
  const available = useSuperAgentAvailability(undefined, optedIn && enabled)
  useEffect(() => {
    if (enabled) {
      if (useSuperAgentUIStore.getState().restoreTab && !hasOpenSuperAgent()) openSuperAgent()
      return
    }
    const tools = useGlobalToolsStore.getState()
    for (const pane of getLeafPanes(tools.paneTree)) {
      for (const tab of pane.tabs) if (tab.type === 'superagent') tools.closePaneTab(pane.id, tab.id, 'unavailable')
    }
  }, [enabled])
  useEffect(() => {
    const api = window.electron?.superAgent
    if (!api || !available) return
    let disposed = false
    const loaded = new Set<string>(), versions = new Map<string, number>(), environmentVersions = new Map<string, number>()
    const add = useSuperAgentUIStore.getState().addNotice
    const refresh = async (workspaceId: string, baseline = false) => {
      const version = (versions.get(workspaceId) ?? 0) + 1
      versions.set(workspaceId, version)
      const records = await api.snapshot(workspaceId)
      if (disposed || versions.get(workspaceId) !== version) return
      for (const work of records.works) {
        const report = records.reports.find(row => row.id === work.latestReportId && row.executionId === work.latestExecutionId)
        const input = records.inputs.find(row => row.id === work.sourceInputId)
        if (work.closedAt !== null || !report || !input) continue
        add({ id: 'superagent-report:' + report.id, workspaceId, workId: work.id, conversationId: input.conversationId,
          title: work.title, kind: report.kind, summary: report.summary, createdAt: report.receivedAt, silent: baseline })
      }
    }
    const publishWorker = async (worker: SuperAgentWorkerSnapshot, baseline = false) => {
      if (worker.retiredAt !== undefined || worker.restored || (worker.stopConfirmed && worker.phase !== 'failed')) return
      const request = worker.conversation.questions?.find(row => row.status === 'pending')
      const approval = worker.conversation.approvals[0]
      const commit = worker.commitRequest?.status === 'pending' ? worker.commitRequest : undefined
      if (!request && !approval && !commit && !worker.conversation.needsTerminal && worker.phase !== 'failed') return
      const detail = await api.workDetail(worker.workspaceId, worker.workId)
      if (disposed || detail.work.latestExecutionId !== worker.executionId || detail.work.closedAt !== null) return
      const identity = request ? `question:${request.id}:${request.version}` : approval ? `approval:${approval.id}` : commit ? `commit:${commit.id}` : worker.phase === 'failed' ? 'failed' : 'unsupported'
      add({ id: `superagent-native:${worker.executionId}:${identity}`, workspaceId: worker.workspaceId, workId: worker.workId,
        conversationId: worker.conversationId, title: detail.work.title, kind: worker.phase === 'failed' ? 'failure' : 'question',
        summary: worker.diagnostic ?? i18n.t('janus:superagent.decisionNeeded'), createdAt: Date.now(), silent: baseline })
    }
    const refreshEnvironments = async (workspaceId: string, baseline = false) => {
      const version = (environmentVersions.get(workspaceId) ?? 0) + 1
      environmentVersions.set(workspaceId, version)
      const snapshot = await api.environments(workspaceId)
      for (const operation of snapshot.operations) {
        if (!['pending', 'failed', 'unknown', 'stale'].includes(operation.status)) continue
        const detail = await api.workDetail(workspaceId, operation.workId)
        if (disposed || environmentVersions.get(workspaceId) !== version) return
        const input = detail.inputs.find(row => row.id === detail.work.sourceInputId)
        if (detail.work.closedAt !== null || !input) continue
        add({ id: `superagent-git:${operation.id}:${operation.status}`, workspaceId, workId: operation.workId,
          conversationId: input.conversationId, title: detail.work.title, kind: operation.status === 'pending' ? 'question' : 'failure',
          summary: operation.message ?? i18n.t(`janus:superagent.gitOperation.${operation.plan.kind}`),
          createdAt: operation.finishedAt ?? operation.createdAt, silent: baseline })
      }
    }
    const logFailure = (error: unknown) => { if (!disposed) console.error('[superagent] notification read failed', error) }
    const loadWorkspaces = () => {
      if (!useSuperAgentUIStore.getState().started) return
      for (const workspace of useWorkspaceStore.getState().workspaces) {
        if (loaded.has(workspace.id)) continue
        loaded.add(workspace.id)
        void refresh(workspace.id, true).catch(logFailure)
        void refreshEnvironments(workspace.id, true).catch(logFailure)
        void api.workers(workspace.id).then(workers => Promise.all(workers.map(worker => publishWorker(worker, true)))).catch(logFailure)
      }
    }
    const records = api.onChanged(change => { if (change.kind === 'report') void refresh(change.workspaceId).catch(logFailure) })
    const workers = api.onWorkerChanged(worker => { void publishWorker(worker).catch(logFailure) })
    const environments = api.onEnvironmentsChanged(change => { void refreshEnvironments(change.workspaceId).catch(logFailure) })
    const workspaces = useWorkspaceStore.subscribe(loadWorkspaces)
    const activation = useSuperAgentUIStore.subscribe((next, prev) => {
      if (next.started !== prev.started) loadWorkspaces()
    })
    loadWorkspaces()
    return () => { disposed = true; records(); workers(); environments(); workspaces(); activation() }
  }, [available])
}
