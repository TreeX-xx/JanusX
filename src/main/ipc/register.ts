import type { BrowserWindow } from 'electron'
import type { OfficeArtifactIndex } from '../office/office-artifact-index'
import type { OfficeWatchPool } from '../office/office-watch-pool'
import type { ResolveWorkspaceRoot } from '../office/office-workspace-guard'
import { createProductionOfficeOperations } from '../office/office-handler-operations'
import type { BrowserSurfaceManager } from '../browser/surface-manager'
import { registerAgentHandlers } from './janus-runner-handlers'
import { registerBrowserHandlers } from './browser-handlers'
import { registerPluginHandlers } from './plugin-handlers'
import { registerCheckpointHandlers } from './checkpoint-handlers'
import { registerSessionHandlers } from './session-handlers'
import { disposeWorktreeWatchers, registerWorktreeHandlers } from './worktree-handlers'
import { registerHostedHandlers } from './hosted-handlers'
import { registerFileHandlers } from './file-handlers'
import { registerGitHandlers } from './git-handlers'
import { disposeWorkspaceWatchers, registerWorkspaceHandlers } from './handlers'
import { registerJanusHandlers } from './janus-handlers'
import { registerHarnessHandlers } from './harness-handlers'
import { registerBlueprintReviewHandlers } from './blueprint-review-handlers'
import { registerJanusChatHandlers } from './janus-chat-handlers'
import { registerMemoHandlers } from './memo-handlers'
import { registerRoundtableHandlers } from './roundtable-handlers'
import { registerKnowledgeHandlers } from './knowledge-handlers'
import { registerLanguageHandlers } from './language-handlers'
import { registerLlmHandlers } from './llm-handlers'
import { registerOfficeHandlers } from './office-handlers'
import { registerProjectHandlers } from './project-handlers'
import { registerRuntimeTelemetryHandlers } from './runtime-telemetry-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerSubAgentRunHandlers } from './subagent-run-handlers'
import { registerTeamHandlers } from './team-handlers'
import { registerUpdaterHandlers } from './updater-handlers'
import { registerPeerHandlers, registerRemoteHandlers } from './remote-handlers'
import { handleTerminalHostWindowClosed, registerTerminalHandlers } from './terminal-handlers'
import { knowledgeProcessingQueue } from '../knowledge/processing-queue'
import { knowledgeObservationService } from '../knowledge/observation-service'
import { installMemoryDomainControls } from '../knowledge/memory-domain-controls'
import { memoryDomainPolicy } from '../knowledge/memory-domain-policy'
import { observationScope } from '../knowledge/memory-evidence'
import { runDeterministicStage } from '../knowledge/deterministic-extractor'
import { registerLayaScorer } from '../knowledge/laya-runtime'
import { runCandidateAction } from '../knowledge/candidate-actions'
import { runLlmStage } from '../knowledge/llm-stage'
import { appShutdown } from '../shutdown/AppShutdown'
import { knowledgeRefinementTasks } from '../knowledge/refinement-tasks'
import { terminalManager } from '../terminal/manager'
import { subAgentRunRegistry } from '../janus-runner/subagent-run-registry'
import { ipcMain } from 'electron'
import { registerAgentRuntimeHandlers } from './agent-runtime-handlers'
import { registerExternalCliHandlers } from './external-cli-handlers'
import { registerWorkflowXHandlers } from './workflowx-handlers'
import { registerWorkspaceRuntimeHandlers } from './workspace-runtime-handlers'
import { registerWorkspaceStorageHandlers, syncWorkspaceStorageRecords } from './workspace-storage-handlers'
export interface RegisterApplicationIpcOptions {
  mainWindow: BrowserWindow
  getAllowedWindows: () => BrowserWindow[]
  resolveWorkspaceRoot: ResolveWorkspaceRoot
  officeWatchPool: OfficeWatchPool
  officeArtifactIndex: OfficeArtifactIndex
  browserSurfaces: BrowserSurfaceManager
}

/** 幂等守卫：重复调用不再触发 "Attempted to register a second handler"。 */
let applicationIpcRegistered = false
let pluginService: ReturnType<typeof registerPluginHandlers> | undefined

/**
 * 当前主窗口。handler 通过 getter 读取，而非按值捕获——
 * macOS activate / second-instance 重建窗口后，旧闭包不再持有已销毁窗口，
 * 新窗口也能继续收到 terminal/janus-agent/checkpoint 事件（audit M1）。
 */
let currentMainWindow: BrowserWindow | null = null

function getCurrentMainWindow(): BrowserWindow | null {
  return currentMainWindow && !currentMainWindow.isDestroyed() ? currentMainWindow : null
}

export function registerApplicationIpc(options: RegisterApplicationIpcOptions): void {
  const { mainWindow, officeWatchPool, officeArtifactIndex } = options

  // 每次窗口重建都重绑窗口级引用与生命周期监听；幂等守卫只拦 handler 注册。
  currentMainWindow = mainWindow
  subAgentRunRegistry.setMainWindow(mainWindow)
  mainWindow.on('closed', () => {
    pluginService?.closeAll()
    if (currentMainWindow === mainWindow) currentMainWindow = null
    subAgentRunRegistry.setMainWindow(null)
    // Also disposed from AppShutdown; function is idempotent.
    disposeWorkspaceWatchers()
    disposeWorktreeWatchers()
    handleTerminalHostWindowClosed()
  })

  registerAgentRuntimeHandlers(getCurrentMainWindow, ipcMain, options.resolveWorkspaceRoot, () => pluginService)
  if (applicationIpcRegistered) {
    mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) pluginService?.closeAll() })
    mainWindow.webContents.on('render-process-gone', () => pluginService?.closeAll())
    return
  }
  applicationIpcRegistered = true
  registerWorkspaceStorageHandlers(options.getAllowedWindows)

  registerWorkspaceHandlers(getCurrentMainWindow, {
    storageChanged: syncWorkspaceStorageRecords,
    getAllowedWindows: options.getAllowedWindows,
    beforeWorkspaceDelete: async (workspaceId) => {
      // 删除工作区前先回收其全部终端，避免 pty 子进程变孤儿；onExit 负责状态清理。
      terminalManager.killByWorkspace(workspaceId)
      const { getProjectRunner } = await import('../project/runner/service')
      const runner = getProjectRunner()
      for (const [id, task] of runner.getAllRunning()) if (task.workspaceId === workspaceId) await runner.stop(id)
      await officeWatchPool.stopUnderRoot(workspaceId)
      officeArtifactIndex.dispose(workspaceId)
    },
  })
  registerWorkspaceRuntimeHandlers(options.getAllowedWindows)
  registerTerminalHandlers(getCurrentMainWindow)
  registerBrowserHandlers(getCurrentMainWindow, options.browserSurfaces)
  pluginService = registerPluginHandlers(getCurrentMainWindow, options.resolveWorkspaceRoot)
  registerGitHandlers()
  registerAgentHandlers(getCurrentMainWindow)
  registerCheckpointHandlers()
  registerSessionHandlers(getCurrentMainWindow)
  registerWorktreeHandlers(getCurrentMainWindow)
  registerHostedHandlers()
  registerFileHandlers()
  registerProjectHandlers()
  registerLlmHandlers()
  registerExternalCliHandlers({ getAllowedWindows: options.getAllowedWindows })
  registerWorkflowXHandlers(options)
  registerJanusHandlers()
  registerHarnessHandlers(getCurrentMainWindow)
  registerBlueprintReviewHandlers()
  registerJanusChatHandlers()
  registerMemoHandlers()
  registerRoundtableHandlers(getCurrentMainWindow)
  registerRuntimeTelemetryHandlers()
  registerSettingsHandlers()
  registerLanguageHandlers()
  registerSubAgentRunHandlers()
  registerKnowledgeHandlers()
  registerTeamHandlers()
  registerUpdaterHandlers()
  registerRemoteHandlers()
  registerPeerHandlers()
  // Phase 1-2: plug the deterministic stage into the processing queue and
  // report unprocessed ranges from the persisted cursor on startup.
  // Persist plans after deterministic batches; recover model tasks independently of cursors.
  installMemoryDomainControls()
  registerLayaScorer()
  knowledgeProcessingQueue.configureCandidateActionHandler(runCandidateAction)
  knowledgeProcessingQueue.configureDeterministicHandler((batch) =>
    runDeterministicStage(batch, { allowHabitSource: async observation => {
      const policy = await memoryDomainPolicy()
      return observationScope(observation) === 'user' ? policy.personal : policy.inferEngineeringHabits
    } }).then(() => undefined),
  )
  appShutdown.configure({ stopKnowledge: () => knowledgeProcessingQueue.dispose() })
  knowledgeProcessingQueue.configureLlmHandler(runLlmStage)
  knowledgeProcessingQueue.configureRefinementHandler(
    workspaceId => knowledgeRefinementTasks.runDue(workspaceId ?? 'user'),
    () => knowledgeRefinementTasks.stats(),
  )
  knowledgeProcessingQueue.startRefinementLoop()
  // Phase 5 (§6): retention maintenance joins the queue — daily low-peak
  // autoPrune + archive + compact with confirm:true. Best-effort: failures
  // audit processing_failed and retry on the next due-check.
  knowledgeProcessingQueue.configureMaintenanceHandler(async () => {
    await knowledgeObservationService.autoPrune()
    await knowledgeObservationService.archiveOldShards({ confirm: true })
    await knowledgeObservationService.compactEvidence({ confirm: true })
    const { userEpisodeService } = await import('../knowledge/user-episode-service')
    await userEpisodeService.harvest(Date.now(), true)
  })
  void knowledgeProcessingQueue.startupRestore()
    .then(async ({ pendingTotal }) => {
      if (pendingTotal > 0) console.log(`[knowledge] processing queue restored with ${pendingTotal} pending observations`)
      await knowledgeProcessingQueue.processRefinementsNow()
    })
    .catch((error: unknown) => {
      console.error(`[knowledge] queue startup restore failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  void knowledgeProcessingQueue.maybeRunMaintenanceIfDue()
    .catch((error: unknown) => {
      console.error(`[knowledge] maintenance startup run failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  knowledgeProcessingQueue.startMaintenanceLoop()
  registerOfficeHandlers({
    getAllowedWindows: options.getAllowedWindows,
    resolveWorkspaceRoot: options.resolveWorkspaceRoot,
    operations: createProductionOfficeOperations({ artifactIndex: officeArtifactIndex, watchPool: officeWatchPool }),
  })
}
