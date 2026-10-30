import { ipcMain } from 'electron'

import { knowledgeContractService } from '../knowledge/contract-service'
import { knowledgeAuditService } from '../knowledge/audit-service'
import { knowledgeObservationService } from '../knowledge/observation-service'
import { observationRevocationContext, revokeObservation, listObservationRevocations } from '../knowledge/observation-revocation'
import { knowledgeExtractService } from '../knowledge/extract-service'
import {
  knowledgeReviewService,
} from '../knowledge/review-service'

import { knowledgeTruthService } from '../knowledge/truth-service'

import { getUserMemoryOverview } from '../knowledge/user-overview-service'
import { userProfileService } from '../knowledge/user-profile-service'
import { importLegacyPersonalMemory } from '../knowledge/legacy-memory-migration'
import { migrateLegacyEpisodes } from '../knowledge/legacy-episode-migration'
import { forgetPersonalMemory } from '../knowledge/personal-memory-forgetting'
import { proposePersonalMemoryCorrection } from '../knowledge/personal-memory-correction'

import { knowledgeProcessingQueue } from '../knowledge/processing-queue'
import { KNOWLEDGE_CHANNELS, type AuditQuery, type AuditPageQuery, type ReviewCandidateInput, type KnowledgeProcessNowInput } from '../../shared/ipc/knowledge';
import type { CaptureObservationInput, Observation, ObservationPruneQuery, ObservationQuery } from '../../shared/knowledge';

export function registerKnowledgeHandlers(): void {
  ipcMain.handle(KNOWLEDGE_CHANNELS.candidateAction, (_event, input: unknown) => knowledgeProcessingQueue.processCandidateAction(input))
  ipcMain.handle(KNOWLEDGE_CHANNELS.importLegacyPersonalMemory, () => importLegacyPersonalMemory())
  ipcMain.handle(KNOWLEDGE_CHANNELS.forgetPersonalMemory, (_event, input: unknown) => forgetPersonalMemory(input))
  ipcMain.handle(KNOWLEDGE_CHANNELS.proposePersonalMemoryCorrection, (_event, input: unknown) => proposePersonalMemoryCorrection(input))

  ipcMain.handle(KNOWLEDGE_CHANNELS.contracts, async () => {
    return knowledgeContractService.getContracts()
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.bootstrap, async (_event, workspacePath?: string) => {
    return knowledgeContractService.bootstrapWorkspace(workspacePath)
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.observe, async (_event, input: CaptureObservationInput) => {
    return knowledgeObservationService.capture(input)
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.listObservations, async (_event, query: ObservationQuery) => {
    return knowledgeObservationService.list(query)
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.pruneObservations, async (_event, query: ObservationPruneQuery) => {
    return knowledgeObservationService.prune(query)
  })
  ipcMain.handle(KNOWLEDGE_CHANNELS.observationRevocationContext, (_event, input: unknown) => observationRevocationContext(input))
  ipcMain.handle(KNOWLEDGE_CHANNELS.revokeObservation, (_event, input: unknown) => revokeObservation(input))
  ipcMain.handle(KNOWLEDGE_CHANNELS.observationRevocations, (_event, input: unknown) => listObservationRevocations(input))

  ipcMain.handle(KNOWLEDGE_CHANNELS.resolveObservationContent, async (_event, observation: Observation) => {
    return knowledgeObservationService.resolveContent(observation)
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.autoPruneObservations, async (_event, nowMs?: number) => {
    return knowledgeObservationService.autoPrune(nowMs)
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.retentionStats, async () => {
    return knowledgeObservationService.stats()
  })

  // Phase 5: audit + archive + compact handlers (additive only).
  ipcMain.handle(KNOWLEDGE_CHANNELS.listAudit, async (_event, query?: AuditQuery) => {
    return knowledgeAuditService.list(query ?? {})
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.auditPage, async (_event, query?: AuditPageQuery) => knowledgeAuditService.page(query))

  ipcMain.handle(KNOWLEDGE_CHANNELS.auditStats, async (_event, query?: AuditQuery) => {
    return knowledgeAuditService.stats(query)
  })

  ipcMain.handle(
    'knowledge:observations:archive',
    async (
      _event,
      options?: { olderThanMonths?: number; confirm?: boolean; nowMs?: number },
    ) => {
      return knowledgeObservationService.archiveOldShards(options ?? {})
    },
  )

  ipcMain.handle(
    'knowledge:observations:compact',
    async (
      _event,
      options?: { olderThanMonths?: number; confirm?: boolean; nowMs?: number },
    ) => {
      return knowledgeObservationService.compactEvidence(options ?? {})
    },
  )

  // Phase 5: `knowledge:extract` direct IPC removed — LLM enhancement runs only
  // via the processing queue (`runLlmStage` → `knowledgeExtractService.extract`).

  ipcMain.handle(KNOWLEDGE_CHANNELS.listCandidates, async () => {
    return knowledgeExtractService.listFactCandidates()
  })

  // MVP review loop: reject / apply (approve+apply combined)
  ipcMain.handle(KNOWLEDGE_CHANNELS.factReviewContext, async (_event, input: ReviewCandidateInput) => knowledgeReviewService.factReviewContext(input))
  ipcMain.handle(
    KNOWLEDGE_CHANNELS.rejectCandidate,
    async (_event, input: ReviewCandidateInput) => {
      return knowledgeReviewService.rejectCandidate(input)
    },
  )

  ipcMain.handle(
    KNOWLEDGE_CHANNELS.applyCandidate,
    async (_event, input: ReviewCandidateInput) => {
      return knowledgeReviewService.applyCandidate(input)
    },
  )

  ipcMain.handle(KNOWLEDGE_CHANNELS.listTruth, async () => {
    return knowledgeTruthService.list({ includeStaleWiki: true })
  })


  // User memory M4: workspace-free glance payload for persona cards plus badge.
  ipcMain.handle(KNOWLEDGE_CHANNELS.userMemoryOverview, async () => {
    return getUserMemoryOverview()
  })
  ipcMain.handle(KNOWLEDGE_CHANNELS.personalProfileEditContext, () => userProfileService.editContext())
  ipcMain.handle(KNOWLEDGE_CHANNELS.migrateLegacyEpisodes, (_event, input: unknown) => migrateLegacyEpisodes(input))
  ipcMain.handle(KNOWLEDGE_CHANNELS.savePersonalProfile, (_event, input: unknown) => userProfileService.replace(input))

  // Phase 0: read-only pipeline diagnostics for the Workbench status bar.

  // Phase 1: processing queue manual trigger + metrics (deterministic handler is wired in register.ts).
  ipcMain.handle(KNOWLEDGE_CHANNELS.processNow, async (_event, input?: KnowledgeProcessNowInput) => {
    return knowledgeProcessingQueue.processNow(input?.workspaceId)
  })

  ipcMain.handle(KNOWLEDGE_CHANNELS.processingStats, async () => {
    // Phase 5: return the full queue snapshot (§6 metrics). Previous
    // shaping dropped llmConfigured/llmSucceeded/llmFailed/llmSkipped and
    // lastRun, hiding LLM degradation from the status bar.
    return knowledgeProcessingQueue.processingStats()
  })

}
