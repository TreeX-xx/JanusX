/**
 * @file Janus / Blueprint IPC Handlers
 * @description
 *  - 保留历史蓝图 CRUD、节点、焦点和终端绑定的兼容调用。
 *  - 保留已有分析记录的读取与采纳，不调度新的后台分析。
 *  - 旧审核、维护及手动分析入口返回 BLUEPRINT_PLUGIN_REQUIRED。
 */

import { ipcMain } from 'electron'
import { resolve } from 'node:path'
import { harnessNoteService } from '../harness/service'
import { blueprintStore } from '../janus/blueprint-store'
import { requireBlueprintPlugin } from '../plugins/legacy-blueprint'

import type {
  BlueprintFeatureItem,
  BlueprintNode,
} from '../../../plugins/blueprint/src/shared/janus/types'
import {
  JANUS_COMMAND_CHANNELS,
  type AcceptCandidatePayload,
  type AcceptDiscoveredPayload,
  type AnalysisHistoryPayload,
  type ApplyAnalysisPatchPayload,
  type ApplyAnalysisPayload,
  type BlueprintCreateInput,
  type BlueprintUpdatePatch,
  type FeatureItemInput,
  type ListCandidatesPayload,
  type NodeCreateInput,
  type RejectCandidatePayload,
} from '../../shared/ipc/janus'

export function registerJanusHandlers(): void {
  // Note: compatibility CRUD never schedules analysis; review belongs to the installed plugin.

  // ───────────── 蓝图 CRUD（§6.1） ─────────────
  ipcMain.handle(JANUS_COMMAND_CHANNELS.listBlueprints, async (_e, cwd: string) => {
    return blueprintStore.listBlueprints(cwd)
  })

  ipcMain.handle(JANUS_COMMAND_CHANNELS.listBlueprintSummaries, async (_e, cwd: string) => {
    return blueprintStore.listBlueprintSummaries(cwd)
  })

  ipcMain.handle(JANUS_COMMAND_CHANNELS.loadBlueprint, async (_e, cwd: string, id: string) => {
    const blueprint = await blueprintStore.loadBlueprint(cwd, id)
    if (blueprint?.source === 'harness') await harnessNoteService.watch(resolve(cwd))
    return blueprint
  })

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.createBlueprint,
    async (_e, cwd: string, input: BlueprintCreateInput) => {
      const bp = await blueprintStore.createBlueprint(cwd, input)
      return bp
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.updateBlueprint,
    async (_e, cwd: string, id: string, patch: BlueprintUpdatePatch) => {
      return blueprintStore.updateBlueprint(cwd, id, patch)
    }
  )

  ipcMain.handle(JANUS_COMMAND_CHANNELS.deleteBlueprint, async (_e, cwd: string, id: string) => {
    return blueprintStore.deleteBlueprint(cwd, id)
  })

  // Note: legacy calls point to the installed plugin without starting host jobs — see .agents/notes/planning/blueprint-official-plugin.md
  for (const channel of [
    JANUS_COMMAND_CHANNELS.maintenanceList, JANUS_COMMAND_CHANNELS.maintenanceAuditList,
    JANUS_COMMAND_CHANNELS.maintenanceStart, JANUS_COMMAND_CHANNELS.maintenanceApply,
    JANUS_COMMAND_CHANNELS.maintenancePreview, JANUS_COMMAND_CHANNELS.maintenanceCancel,
    JANUS_COMMAND_CHANNELS.maintenanceComplete, JANUS_COMMAND_CHANNELS.maintenanceDismiss,
    JANUS_COMMAND_CHANNELS.maintenanceUndoPrepare, JANUS_COMMAND_CHANNELS.maintenanceUndoApply,
    JANUS_COMMAND_CHANNELS.dispatchComposeBrief,
  ]) ipcMain.handle(channel, async () => requireBlueprintPlugin())

  // ───────────── 节点操作（§6.2） ─────────────
  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.createNode,
    async (
      _e,
      cwd: string,
      blueprintId: string,
      input: NodeCreateInput,
      parentId: string | null
    ) => {
      const node = await blueprintStore.createNode(cwd, blueprintId, input, parentId)
      return node
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.updateNode,
    async (_e, cwd: string, blueprintId: string, nodeId: string, patch: Partial<BlueprintNode>) => {
      return blueprintStore.updateNode(cwd, blueprintId, nodeId, patch)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.replaceNodeFeatures,
    async (
      _e,
      cwd: string,
      blueprintId: string,
      nodeId: string,
      features: FeatureItemInput[]
    ) => {
      return blueprintStore.patchNodeFeatures(cwd, blueprintId, nodeId, features)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.addNodeFeature,
    async (
      _e,
      cwd: string,
      blueprintId: string,
      nodeId: string,
      feature: FeatureItemInput
    ) => {
      return blueprintStore.appendNodeFeature(cwd, blueprintId, nodeId, feature)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.updateNodeFeature,
    async (
      _e,
      cwd: string,
      blueprintId: string,
      nodeId: string,
      featureId: string,
      patch: Partial<BlueprintFeatureItem>
    ) => {
      return blueprintStore.updateNodeFeature(cwd, blueprintId, nodeId, featureId, patch)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.deleteNodeFeature,
    async (_e, cwd: string, blueprintId: string, nodeId: string, featureId: string) => {
      return blueprintStore.deleteNodeFeature(cwd, blueprintId, nodeId, featureId)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.deleteNode,
    async (_e, cwd: string, blueprintId: string, nodeId: string) => {
      return blueprintStore.deleteNode(cwd, blueprintId, nodeId)
    }
  )

  // ───────────── 节点协作会话 / 终端绑定（§6.4） ─────────────
  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.focusNode,
    async (_e, cwd: string, nodeId: string) => {
      const node = await blueprintStore.focusNode(cwd, nodeId)
      return node
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.bindTerminal,
    async (_e, cwd: string, nodeId: string, terminalId: string) => {
      const node = await blueprintStore.bindTerminal(cwd, nodeId, terminalId)
      return node
    }
  )

  // ───────────── 分析器：手动触发（入口③） ─────────────
  ipcMain.handle(JANUS_COMMAND_CHANNELS.analyze, async () => requireBlueprintPlugin())

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.applyAnalysisPatch,
    async (
      _e,
      payload: ApplyAnalysisPatchPayload
    ) => {
      return blueprintStore.applyAnalysisPatch(payload.workspacePath, payload.blueprintId, payload.nodeId, payload.patch)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.listAnalyses,
    async (
      _e,
      payload: AnalysisHistoryPayload
    ) => {
      return blueprintStore.listAnalyses(payload.workspacePath, payload.blueprintId, payload.nodeId)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.applyAnalysis,
    async (
      _e,
      payload: ApplyAnalysisPayload
    ) => {
      return blueprintStore.applyAnalysis(payload.workspacePath, payload.blueprintId, payload.nodeId, payload.analysisId)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.listRequirementCandidates,
    async (
      _e,
      payload: ListCandidatesPayload
    ) => {
      return blueprintStore.listRequirementCandidates(payload.workspacePath, payload.blueprintId, payload.status)
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.acceptRequirementCandidate,
    async (
      _e,
      payload: AcceptCandidatePayload
    ) => {
      const node = await blueprintStore.acceptRequirementCandidate(
        payload.workspacePath,
        payload.blueprintId,
        payload.candidateId,
        {
          title: payload.title,
          description: payload.description,
          parentId: payload.parentId,
          decisionNote: payload.decisionNote
        }
      )
      return node
    }
  )

  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.rejectRequirementCandidate,
    async (
      _e,
      payload: RejectCandidatePayload
    ) => {
      return blueprintStore.rejectRequirementCandidate(
        payload.workspacePath,
        payload.blueprintId,
        payload.candidateId,
        payload.decisionNote
      )
    }
  )

  // ───────────── 分析器：接受新需求提议（§5.5 闭环） ─────────────
  ipcMain.handle(
    JANUS_COMMAND_CHANNELS.acceptDiscovered,
    async (
      _e,
      payload: AcceptDiscoveredPayload
    ) => {
      const { workspacePath, blueprintId, discovered, parentId, fallbackNodeId } = payload
      const bp = await blueprintStore.loadBlueprint(workspacePath, blueprintId)
      if (!bp) return null

      // 解析父节点：显式 > 标题匹配 > fallbackNodeId > 根节点
      let resolvedParentId = parentId ?? null
      if (!resolvedParentId && discovered.suggestedParent) {
        const match = Object.values(bp.nodes).find(
          (n) => n.title.trim().toLowerCase() === discovered.suggestedParent.trim().toLowerCase()
        )
        if (match) resolvedParentId = match.id
      }
      if (!resolvedParentId && fallbackNodeId && bp.nodes[fallbackNodeId]) {
        resolvedParentId = fallbackNodeId
      }
      if (!resolvedParentId) resolvedParentId = bp.rootNodeId

      const node = await blueprintStore.createNode(
        workspacePath,
        blueprintId,
        {
          title: discovered.title,
          type: 'task',
          description: discovered.description,
          status: 'not-started',
          progress: 0,
          tags: ['discovered-by-janus']
        },
        resolvedParentId
      )
      return node
    }
  )
}
