import { contextBridge, ipcRenderer } from 'electron'
import { WORKSPACE_RUNTIME_CHANNELS, type WorkspaceRuntimeAPI } from '../shared/workspace-runtime'
import { BLUEPRINT_REVIEW_CHANNELS } from '../shared/ipc/legacy-review-channels'
import type { BlueprintReviewAPI } from '../../plugins/blueprint/src/shared/ipc/blueprint-review'
import os from 'node:os'
import { JANUS_PERSONA } from '../shared/janus/persona'
import { OFFICE_EVENT_CHANNELS, OFFICE_INVOKE_CHANNELS, type OfficeAPI } from '../shared/office'
import {
  FILE_CHANNELS,
  FILE_TREE_CHANNELS,
  WORKSPACE_CHANNELS,
  type FileAPI,
  type FileTreeAPI,
  type WorkspaceAPI,
} from '../shared/ipc/workspace'
import {
  TERMINAL_EVENT_CHANNELS,
  TERMINAL_INVOKE_CHANNELS,
  TERMINAL_SEND_CHANNELS,
  type TerminalAPI,
} from '../shared/ipc/terminal'
import { PROJECT_CHANNELS, type ProjectAPI } from '../shared/ipc/project'
import { BROWSER_EVENT_CHANNELS, BROWSER_INVOKE_CHANNELS, type BrowserAPI } from '../shared/ipc/browser'
import { PLUGIN_CHANNELS, type PluginHostAPI } from '../shared/ipc/plugins'
import { KNOWLEDGE_CHANNELS, type KnowledgeAPI } from '../shared/ipc/knowledge'
import {
  JANUS_COMMAND_CHANNELS,
  JANUS_EVENT_CHANNELS,
  type JanusAPI
} from '../shared/ipc/janus'
import { AGENT_CHANNELS, SUBAGENT_RUN_CHANNELS, type AgentAPI, type SubAgentRunAPI } from '../shared/ipc/janus-runner'
import { AGENT_RUNTIME_CHANNELS, type AgentRuntimeAPI } from '../shared/ipc/agent-runtime'
import { CHECKPOINT_CHANNELS, type CheckpointAPI } from '../shared/ipc/checkpoint'
import { SESSION_CHANNELS, type SessionAPI } from '../shared/ipc/session'
import { WORKTREE_CHANNELS, type WorktreeAPI } from '../shared/ipc/worktree'
import { HOSTED_CHANNELS, type HostedAPI } from '../shared/ipc/hosted'
import { GIT_CHANNELS, type GitAPI } from '../shared/ipc/git'
import { LLM_CHANNELS, type LlmAPI } from '../shared/ipc/llm'
import { EXTERNAL_CLI_CHANNELS, type ExternalCliAPI } from '../shared/ipc/external-cli'
import { WORKFLOWX_CHANNELS, type WorkflowXAPI } from '../shared/ipc/workflowx'
import { JANUS_CHAT_CHANNELS, type JanusChatAPI } from '../shared/ipc/janus-chat'
import { MEMO_CHANNELS, type MemoAPI } from '../shared/ipc/memo'
import { HARNESS_COMMAND_CHANNELS, HARNESS_EVENT_CHANNELS, type HarnessAPI } from '../shared/ipc/harness'
import { ROUNDTABLE_CHANNELS, type RoundtableAPI } from '../shared/ipc/roundtable'
import { AGENT_SETTINGS_CHANNELS, NOTIFICATION_SETTINGS_CHANNELS, type AgentSettingsAPI, type NotificationSettingsAPI } from '../shared/ipc/settings'
import { EXPERIMENTAL_CHANNELS, type ExperimentalAPI } from '../shared/ipc/experimental'
import { THEME_CHANNELS, type AppTheme, type ThemeAPI } from '../shared/ipc/theme'
import { SYSTEM_CHANNELS, type DesktopToastAPI, type DialogAPI, type SystemAPI, type WindowAPI } from '../shared/ipc/system'
import { TEAM_CHANNELS, type TeamAPI } from '../shared/ipc/team'
import { UPDATER_CHANNELS, UPDATER_EVENT_CHANNELS, type UpdaterAPI } from '../shared/ipc/updater'
import { REMOTE_CHANNELS, type RemoteAPI } from '../shared/ipc/remote'
import { SHELL_PROFILE_CHANNELS, type ShellProfilesAPI } from '../shared/ipc/shell-profiles'

const blueprintReviewAPI: BlueprintReviewAPI = {
  repairPrepare: input => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.repairPrepare, input),
  repairDiff: id => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.repairDiff, id),
  repairUndo: id => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.repairUndo, id),
  repairRetryReview: id => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.repairRetryReview, id),
  activityRead: root => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.activityRead, root),
  onActivityChanged: callback => subscribeIpcEvent(BLUEPRINT_REVIEW_CHANNELS.activityChanged, callback),
  onResultsChanged: callback => subscribeIpcEvent(BLUEPRINT_REVIEW_CHANNELS.resultsChanged, callback),
  onReadChanged: callback => subscribeIpcEvent(BLUEPRINT_REVIEW_CHANNELS.readChanged, callback),
  markRead: (context, versions, bulk) => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.markRead, context, versions, bulk),
  undoRead: token => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.undoRead, token),
  read: root => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.read, root),
  readSaved: root => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.readSaved, root),
  run: (root, noteId) => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.run, root, noteId),
  close: (context, noteId, revision, ids) => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.close, context, noteId, revision, ids),
  cancel: (root, noteId) => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.cancel, root, noteId),
  settingsGet: () => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.settingsGet),
  settingsUpdate: settings => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.settingsUpdate, settings),
  configurationTest: () => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.configurationTest),
  credentialStatus: () => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.credentialStatus),
  credentialGet: () => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.credentialGet),
  credentialSet: key => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.credentialSet, key),
  mcpStatus: () => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.mcpStatus),
  mcpChange: input => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.mcpChange, input),
  mcpProbe: () => ipcRenderer.invoke(BLUEPRINT_REVIEW_CHANNELS.mcpProbe),
}

const workspaceRuntimeAPI: WorkspaceRuntimeAPI = {
  detectCli: (id, tool) => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.detectCli, id, tool),
  installCli: (id, tool) => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.installCli, id, tool),
  cliInstallStatus: (id, tool) => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.cliInstallStatus, id, tool),
  distributions: () => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.distributions),
  hosts: () => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.hosts),
  connect: runtime => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.connect, runtime),
  browse: (runtime, path) => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.browse, runtime, path),
  terminals: id => ipcRenderer.invoke(WORKSPACE_RUNTIME_CHANNELS.terminals, id),
}

const workspaceAPI: WorkspaceAPI = {
  initialize: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.initialize),
  list: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.list),
  load: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.load, id),
  create: (input) => ipcRenderer.invoke(WORKSPACE_CHANNELS.create, input),
  update: (id, updates) => ipcRenderer.invoke(WORKSPACE_CHANNELS.update, id, updates),
  delete: (id) => ipcRenderer.invoke(WORKSPACE_CHANNELS.delete, id),
}

const fileTreeAPI: FileTreeAPI = {
  load: (rootPath) => ipcRenderer.invoke(FILE_TREE_CHANNELS.load, rootPath),
  children: (rootPath, relativePath) => ipcRenderer.invoke(FILE_TREE_CHANNELS.children, rootPath, relativePath),
  createFile: (rootPath, parentRelativePath, name) =>
    ipcRenderer.invoke(FILE_TREE_CHANNELS.createFile, rootPath, parentRelativePath, name),
  createDirectory: (rootPath, parentRelativePath, name) =>
    ipcRenderer.invoke(FILE_TREE_CHANNELS.createDirectory, rootPath, parentRelativePath, name),
  rename: (rootPath, relativePath, name) => ipcRenderer.invoke(FILE_TREE_CHANNELS.rename, rootPath, relativePath, name),
  move: (rootPath, sourceRelativePath, targetDirectoryRelativePath) =>
    ipcRenderer.invoke(FILE_TREE_CHANNELS.move, rootPath, sourceRelativePath, targetDirectoryRelativePath),
  delete: (rootPath, relativePath) => ipcRenderer.invoke(FILE_TREE_CHANNELS.delete, rootPath, relativePath),
  reveal: (rootPath, relativePath) => ipcRenderer.invoke(FILE_TREE_CHANNELS.reveal, rootPath, relativePath),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { workspacePath: string; changedFilePath?: string | null }) => callback(payload)
    ipcRenderer.on(FILE_TREE_CHANNELS.changed, handler)
    return () => ipcRenderer.removeListener(FILE_TREE_CHANNELS.changed, handler)
  },
}

const fileAPI: FileAPI = {
  read: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.read, filePath),
    save: (filePath, content, expectedVersion) => expectedVersion === undefined
      ? ipcRenderer.invoke(FILE_CHANNELS.save, filePath, content)
      : ipcRenderer.invoke(FILE_CHANNELS.save, filePath, content, expectedVersion),
  openHtmlPreview: (request) => ipcRenderer.invoke(FILE_CHANNELS.openHtmlPreview, request),
  openPreviewLink: (url) => ipcRenderer.invoke(FILE_CHANNELS.openPreviewLink, url),
  updateHtmlPreview: (id, content) => ipcRenderer.invoke(FILE_CHANNELS.updateHtmlPreview, id, content),
  closeHtmlPreview: (id) => ipcRenderer.invoke(FILE_CHANNELS.closeHtmlPreview, id),
  readBinary: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.readBinary, filePath),
  stat: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.stat, filePath),
}

function subscribeIpcEvent<T>(channel: string, callback: (event: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const terminalAPI: TerminalAPI = {
  warmup: (request) => ipcRenderer.invoke(TERMINAL_INVOKE_CHANNELS.warmup, request),
  create: (request) => ipcRenderer.invoke(TERMINAL_INVOKE_CHANNELS.create, request),
  replay: (id) => ipcRenderer.invoke(TERMINAL_INVOKE_CHANNELS.replay, { id }),
  kill: (id) => ipcRenderer.invoke(TERMINAL_INVOKE_CHANNELS.kill, { id }),
  input: (id, data) => ipcRenderer.send(TERMINAL_SEND_CHANNELS.input, { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send(TERMINAL_SEND_CHANNELS.resize, { id, cols, rows }),
  submitLine: (id, text) => ipcRenderer.send(TERMINAL_SEND_CHANNELS.submitLine, { id, text }),
  onData: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.data, callback),
  onExit: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.exit, callback),
  onFocus: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.focus, callback),
  onCreated: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.created, callback),
  onStatus: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.status, callback),
  onTelemetry: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.telemetry, callback),
  onTurnChanges: (callback) => subscribeIpcEvent(TERMINAL_EVENT_CHANNELS.turnChanges, callback),
}

const projectAPI: ProjectAPI = {
  detect: (projectPath) => ipcRenderer.invoke(PROJECT_CHANNELS.detect, projectPath),
  detectWithDetails: (projectPath) => ipcRenderer.invoke(PROJECT_CHANNELS.detectWithDetails, projectPath),
  readConfig: (projectPath) => ipcRenderer.invoke(PROJECT_CHANNELS.readConfig, projectPath),
  writeConfig: (projectPath, config) => ipcRenderer.invoke(PROJECT_CHANNELS.writeConfig, projectPath, config),
  createDefaultConfig: (projectPath, projectType, projectName) =>
    ipcRenderer.invoke(PROJECT_CHANNELS.createDefaultConfig, projectPath, projectType, projectName),
  validateConfig: (config) => ipcRenderer.invoke(PROJECT_CHANNELS.validateConfig, config),
  test: (projectPath, script) => ipcRenderer.invoke(PROJECT_CHANNELS.test, projectPath, script),
  run: (projectPath, configName, options) => ipcRenderer.invoke(PROJECT_CHANNELS.run, projectPath, configName, options),
  stop: (projectId) => ipcRenderer.invoke(PROJECT_CHANNELS.stop, projectId),
  list: () => ipcRenderer.invoke(PROJECT_CHANNELS.list),
  get: (projectId) => ipcRenderer.invoke(PROJECT_CHANNELS.get, projectId),
  schemas: () => ipcRenderer.invoke(PROJECT_CHANNELS.schemas),
}

const browserAPI: BrowserAPI = {
  createSurface: (request) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.createSurface, request),
  destroySurface: (surfaceId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.destroySurface, surfaceId),
  popOut: (surfaceId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.popOut, surfaceId),
  embed: (surfaceId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.embed, surfaceId),
  setBounds: (surfaceId, bounds) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.setBounds, surfaceId, bounds),
  getState: (surfaceId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.getState, surfaceId),
  getHiddenFrame: (surfaceId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.getHiddenFrame, surfaceId),
  openTab: (surfaceId, url) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.openTab, surfaceId, url),
  closeTab: (surfaceId, tabId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.closeTab, surfaceId, tabId),
  activateTab: (surfaceId, tabId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.activateTab, surfaceId, tabId),
  navigate: (surfaceId, tabId, url) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.navigate, surfaceId, tabId, url),
  goBack: (surfaceId, tabId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.goBack, surfaceId, tabId),
  goForward: (surfaceId, tabId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.goForward, surfaceId, tabId),
  reload: (surfaceId, tabId) => ipcRenderer.invoke(BROWSER_INVOKE_CHANNELS.reload, surfaceId, tabId),
  onStateChanged: (callback) => subscribeIpcEvent(BROWSER_EVENT_CHANNELS.state, callback),
  onAgentControlChanged: (callback) => subscribeIpcEvent(BROWSER_EVENT_CHANNELS.agentControl, callback),
}

const knowledgeAPI: KnowledgeAPI = {
  stopLocalModel: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.localModelStop),
  installLocalResources: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.localResourcesInstall),
  localResourcesStatus: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.localResourcesStatus),
  configureLocalModel: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.localModelConfigure, input),
  contracts: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.contracts),
  bootstrap: (workspacePath) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.bootstrap, workspacePath),
  observe: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.observe, input),
  listObservations: (query) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.listObservations, query),
  pruneObservations: (query) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.pruneObservations, query),
  observationRevocationContext: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.observationRevocationContext, input),
  revokeObservation: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.revokeObservation, input),
  observationRevocations: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.observationRevocations, input),
  autoPruneObservations: (nowMs) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.autoPruneObservations, nowMs),
  resolveObservationContent: (observation) =>
    ipcRenderer.invoke(KNOWLEDGE_CHANNELS.resolveObservationContent, observation),
  retentionStats: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.retentionStats),
  listAudit: (query) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.listAudit, query),
  auditPage: (query) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.auditPage, query),
  auditStats: (query) => query ? ipcRenderer.invoke(KNOWLEDGE_CHANNELS.auditStats, query) : ipcRenderer.invoke(KNOWLEDGE_CHANNELS.auditStats),
  listCandidates: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.listCandidates),
  rejectCandidate: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.rejectCandidate, input),
  applyCandidate: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.applyCandidate, input),
  factReviewContext: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.factReviewContext, input),
  listTruth: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.listTruth),
  processNow: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.processNow, input),
  processingStats: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.processingStats),
  userMemoryOverview: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.userMemoryOverview),
  personalProfileEditContext: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.personalProfileEditContext),
  savePersonalProfile: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.savePersonalProfile, input),
  importLegacyPersonalMemory: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.importLegacyPersonalMemory),
  migrateLegacyEpisodes: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.migrateLegacyEpisodes, input),
  layaControl: (action) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.layaControl, action),
  candidateAction: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.candidateAction, input),
  forgetPersonalMemory: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.forgetPersonalMemory, input),
  proposePersonalMemoryCorrection: (input) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.proposePersonalMemoryCorrection, input),
  getPersonalSettings: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.getPersonalSettings),
  updatePersonalSettings: (settings) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.updatePersonalSettings, settings),
  getSettings: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.getSettings),
  updateSettings: (settings) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.updateSettings, settings),
}

const janusAPI: JanusAPI = {
  listBlueprints: (cwd) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.listBlueprints, cwd),
  listBlueprintSummaries: (cwd) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.listBlueprintSummaries, cwd),
  loadBlueprint: (cwd, id) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.loadBlueprint, cwd, id),
  createBlueprint: (cwd, input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.createBlueprint, cwd, input),
  updateBlueprint: (cwd, id, patch) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.updateBlueprint, cwd, id, patch),
  deleteBlueprint: (cwd, id) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.deleteBlueprint, cwd, id),
  createNode: (cwd, blueprintId, input, parentId) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.createNode, cwd, blueprintId, input, parentId),
  updateNode: (cwd, blueprintId, nodeId, patch) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.updateNode, cwd, blueprintId, nodeId, patch),
  deleteNode: (cwd, blueprintId, nodeId) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.deleteNode, cwd, blueprintId, nodeId),
  replaceNodeFeatures: (cwd, blueprintId, nodeId, features) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.replaceNodeFeatures, cwd, blueprintId, nodeId, features),
  addNodeFeature: (cwd, blueprintId, nodeId, feature) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.addNodeFeature, cwd, blueprintId, nodeId, feature),
  updateNodeFeature: (cwd, blueprintId, nodeId, featureId, patch) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.updateNodeFeature, cwd, blueprintId, nodeId, featureId, patch),
  deleteNodeFeature: (cwd, blueprintId, nodeId, featureId) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.deleteNodeFeature, cwd, blueprintId, nodeId, featureId),
  focusNode: (payload) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.focusNode, payload.workspacePath, payload.nodeId),
  bindTerminal: (cwd, nodeId, terminalId) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.bindTerminal, cwd, nodeId, terminalId),
  analyze: (payload) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.analyze, payload),
  applyAnalysisPatch: (payload) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.applyAnalysisPatch, payload),
  listAnalyses: (payload) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.listAnalyses, payload),
  applyAnalysis: (payload) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.applyAnalysis, payload),
  listRequirementCandidates: (payload) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.listRequirementCandidates, payload),
  acceptRequirementCandidate: (payload) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.acceptRequirementCandidate, payload),
  rejectRequirementCandidate: (payload) =>
    ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.rejectRequirementCandidate, payload),
  acceptDiscovered: (payload) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.acceptDiscovered, payload),
  listMaintenanceTasks: () => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceList),
  listMaintenanceAudits: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceAuditList, input),
  startMaintenanceTask: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceStart, input),
  applyMaintenanceChangeSet: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceApply, input),
  previewMaintenanceChangeSet: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenancePreview, input),
  cancelMaintenanceTask: (taskId) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceCancel, taskId),
  completeMaintenanceTask: (taskId) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceComplete, taskId),
  dismissMaintenanceProposal: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceDismiss, input),
  prepareMaintenanceUndo: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceUndoPrepare, input),
  applyMaintenanceUndo: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.maintenanceUndoApply, input),
  composeDispatchBrief: (input) => ipcRenderer.invoke(JANUS_COMMAND_CHANNELS.dispatchComposeBrief, input),
  onAnalysisResult: (callback) => subscribeIpcEvent(JANUS_EVENT_CHANNELS.analysis, callback),
  onDiscovered: (callback) => subscribeIpcEvent(JANUS_EVENT_CHANNELS.discovered, callback),
  onMaintenanceTask: (callback) => subscribeIpcEvent(JANUS_EVENT_CHANNELS.maintenance, callback),
}

const harnessAPI: HarnessAPI = {
  workspaceStatus: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.workspaceStatus, cwd),
  initPreview: (cwd, name) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.initPreview, cwd, name),
  initApply: (cwd, id, foreign) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.initApply, cwd, id, foreign),
  initUndo: (cwd, id) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.initUndo, cwd, id),
  noteRead: (cwd, uri) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.noteRead, cwd, uri),
  taskRead: (cwd, uri) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.taskRead, cwd, uri),
  taskAdopt: (cwd, uri, expectedHash, contract) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.taskAdopt, cwd, uri, expectedHash, contract),
  resolve: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.resolve, cwd),
  projectGraph: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.projectGraph, cwd),
  rescan: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.rescan, cwd),
  getRev: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.getRev, cwd),
  warmup: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.warmup, cwd),
  noteSnapshot: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.noteSnapshot, cwd),
  apply: (cwd, operations, reason) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.apply, cwd, operations, reason),
  getBindings: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.bindingsGet, cwd),
  setBinding: (cwd, binding) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.bindingsSet, cwd, binding),
  sharePreview: (cwd, selection) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.sharePreview, cwd, selection),
  runPrepare: (cwd, input) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runPrepare, cwd, input),
  runStart: (cwd, runId, owner, authorization) =>
    ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runStart, cwd, runId, owner, authorization),
  runStatus: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runStatus, cwd, runId),
  runList: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runList, cwd),
  runCancel: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runCancel, cwd, runId),
  runCloseout: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runCloseout, cwd, runId),
  runHandoff: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runHandoff, cwd, runId),
  runHandoffRead: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runHandoffRead, cwd, runId),
  runTakeover: (cwd, runId, newOwner, reason) =>
    ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runTakeover, cwd, runId, newOwner, reason),
  runThreads: (cwd) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runThreads, cwd),
  runThread: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runThread, cwd, runId),
  runTranscript: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runTranscript, cwd, runId),
  runThreadClose: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runThreadClose, cwd, runId),
  runReview: (cwd, input) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runReview, cwd, input),
  runFinish: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runFinish, cwd, runId),
  runRepair: (cwd, input) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runRepair, cwd, input),
  noteChatChanges: (cwd, conversationId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.noteChatChanges, cwd, conversationId),
  undoPreview: (cwd, txId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.undoPreview, cwd, txId),
  undoApply: (cwd, txId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.undoApply, cwd, txId),
  migratePreview: (cwd, blueprintId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.migratePreview, cwd, blueprintId),
  migrateApply: (cwd, blueprintId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.migrateApply, cwd, blueprintId),
  runExecute: (cwd, input) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runExecute, cwd, input),
  runPause: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runPause, cwd, runId),
  runResume: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runResume, cwd, runId),
  runRebaseline: (cwd, runId, authorization) =>
    ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runRebaseline, cwd, runId, authorization),
  runAbort: (cwd, runId) => ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.runAbort, cwd, runId),
  shareExport: (cwd, selection, outPath) =>
    ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.shareExport, cwd, selection, outPath),
  shareImportPreview: (cwd, snapshot) =>
    ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.shareImportPreview, cwd, snapshot),
  shareImportApply: (cwd, snapshot) =>
    ipcRenderer.invoke(HARNESS_COMMAND_CHANNELS.shareImportApply, cwd, snapshot),
  onChanged: (callback) => subscribeIpcEvent(HARNESS_EVENT_CHANNELS.changed, callback),
}

const roundtableAPI: RoundtableAPI = {
  start: (input) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.start, input),
  advance: (sessionId, input, requestId) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.advance, sessionId, input, requestId),
  end: (sessionId) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.end, sessionId),
  getState: (sessionId) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.state, sessionId),
  restore: (sessionId) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.restore, sessionId),
  export: (sessionId) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.export, sessionId),
  buildBundle: (sessionId, input) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.bundleBuild, sessionId, input),
  applyBundle: (root, bundle, reason) => ipcRenderer.invoke(ROUNDTABLE_CHANNELS.bundleApply, root, bundle, reason),
  onEvent: (callback) => subscribeIpcEvent(ROUNDTABLE_CHANNELS.event, callback),
}

const officeAPI: OfficeAPI = {
  detect: (request) => ipcRenderer.invoke(OFFICE_INVOKE_CHANNELS.detect, request),
  listFiles: (request) => ipcRenderer.invoke(OFFICE_INVOKE_CHANNELS.listFiles, request),
  startPreview: (request) => ipcRenderer.invoke(OFFICE_INVOKE_CHANNELS.startPreview, request),
  stopPreview: (request) => ipcRenderer.invoke(OFFICE_INVOKE_CHANNELS.stopPreview, request),
  reloadPreview: (request) => ipcRenderer.invoke(OFFICE_INVOKE_CHANNELS.reloadPreview, request),
  buildPrompt: (request) => ipcRenderer.invoke(OFFICE_INVOKE_CHANNELS.buildPrompt, request),
  onFilesChanged: (callback) => subscribeIpcEvent(OFFICE_EVENT_CHANNELS.filesChanged, callback),
  onWatchEvicted: (callback) => subscribeIpcEvent(OFFICE_EVENT_CHANNELS.watchEvicted, callback),
}

const llmAPI: LlmAPI = {
  getConfiguration: () => ipcRenderer.invoke(LLM_CHANNELS.getConfiguration),
  saveProvider: (settings) => ipcRenderer.invoke(LLM_CHANNELS.saveProvider, settings),
  applyBinding: (terminal, binding) => ipcRenderer.invoke(LLM_CHANNELS.applyBinding, terminal, binding),
  getNativeLoginStatus: (terminal) => ipcRenderer.invoke(LLM_CHANNELS.getNativeLoginStatus, terminal),
  startNativeLogin: (terminal) => ipcRenderer.invoke(LLM_CHANNELS.startNativeLogin, terminal),
  stopNativeLogin: (terminal) => ipcRenderer.invoke(LLM_CHANNELS.stopNativeLogin, terminal),
  getTerminalProviders: (terminal) => ipcRenderer.invoke(LLM_CHANNELS.getTerminalProviders, terminal),
  getRuntimeStatus: () => ipcRenderer.invoke(LLM_CHANNELS.runtimeStatus),
  saveTerminalProvider: (terminal, settings) => ipcRenderer.invoke(LLM_CHANNELS.saveTerminalProvider, terminal, settings),
  testConnection: (settings) => ipcRenderer.invoke(LLM_CHANNELS.testConnection, settings),
  discoverModels: (settings) => ipcRenderer.invoke(LLM_CHANNELS.discoverModels, settings),
  removeTerminalProvider: (terminal, providerId) => ipcRenderer.invoke(LLM_CHANNELS.removeTerminalProvider, terminal, providerId),
  setTerminalDefault: (terminal, providerId) => ipcRenderer.invoke(LLM_CHANNELS.setTerminalDefault, terminal, providerId),
  getTerminalDefault: (terminal) => ipcRenderer.invoke(LLM_CHANNELS.getTerminalDefault, terminal),
  listModels: (terminal, providerId) => ipcRenderer.invoke(LLM_CHANNELS.listModels, terminal, providerId),
  getModelCatalog: () => ipcRenderer.invoke(LLM_CHANNELS.getCatalog),
  getChatModelBudget: (providerId, modelId) => ipcRenderer.invoke(LLM_CHANNELS.getChatModelBudget, providerId, modelId),
  refreshModelCatalog: () => ipcRenderer.invoke(LLM_CHANNELS.refreshCatalog),
  getAdapters: () => ipcRenderer.invoke(LLM_CHANNELS.getAdapters),
  chat: (request) => ipcRenderer.invoke(LLM_CHANNELS.chat, request),
  startChatStream: (request) => ipcRenderer.send(LLM_CHANNELS.chatStream, request),
  abortChat: (requestId) => ipcRenderer.invoke(LLM_CHANNELS.abort, requestId),
  steerChat: (input) => ipcRenderer.invoke(LLM_CHANNELS.steer, input),
  cancelSteerChat: (input) => ipcRenderer.invoke(LLM_CHANNELS.steerCancel, input),
  answerQuestion: (payload) => ipcRenderer.invoke(LLM_CHANNELS.answerQuestion, payload),
  onDelta: (callback) => subscribeIpcEvent(LLM_CHANNELS.delta, callback),
  onDone: (callback) => subscribeIpcEvent(LLM_CHANNELS.done, callback),
  onError: (callback) => subscribeIpcEvent(LLM_CHANNELS.error, callback),
  onAgentEvent: (callback) => subscribeIpcEvent(LLM_CHANNELS.agentEvent, callback),
  onRecallTrace: (callback) => subscribeIpcEvent(LLM_CHANNELS.recallTrace, callback),
  onToolTrace: (callback) => subscribeIpcEvent(LLM_CHANNELS.toolTrace, callback),
}

const workflowxAPI: WorkflowXAPI = {
  detect: (workspaceId, refresh) => ipcRenderer.invoke(WORKFLOWX_CHANNELS.detect, workspaceId, refresh),
  openRepository: () => ipcRenderer.invoke(WORKFLOWX_CHANNELS.openRepository),
}

const externalCliAPI: ExternalCliAPI = {
  detect: (toolId) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.detect, toolId),
  latest: (toolId) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.latest, toolId),
  install: (toolId, options) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.install, options ? { toolId, ...options } : toolId),
  applyProvider: (request) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.applyProvider, request),
  syncState: () => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.syncState),
  rollbackProfile: () => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.rollbackProfile),
  readTerminalModel: (toolId) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.terminalRead, toolId),
  applyTerminalModel: (request) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.terminalApply, request),
  rollbackTerminal: (toolId) => ipcRenderer.invoke(EXTERNAL_CLI_CHANNELS.terminalRollback, toolId),
}

const agentAPI: AgentAPI = {
  start: (options) => ipcRenderer.invoke(AGENT_CHANNELS.start, options),
  cancel: (sessionId) => ipcRenderer.invoke(AGENT_CHANNELS.cancel, { sessionId }),
  cancelAll: () => ipcRenderer.invoke(AGENT_CHANNELS.cancelAll),
  listSessions: () => ipcRenderer.invoke(AGENT_CHANNELS.listSessions),
  onEvent: (callback) => subscribeIpcEvent(AGENT_CHANNELS.event, callback),
  onNotification: (callback) => subscribeIpcEvent(AGENT_CHANNELS.notification, callback),
  onHookEvent: (callback) => subscribeIpcEvent(AGENT_CHANNELS.hookEvent, callback),
}

const agentRuntimeAPI: AgentRuntimeAPI = {
  createSession: (input) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.createSession, input),
  executeTool: (input) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.executeTool, input),
  cancelSession: (sessionId) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.cancelSession, sessionId),
  queryPolicyAudit: (query) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.queryPolicyAudit, query),
  resolveApproval: (input) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.resolveApproval, input),
  getSession: (sessionId) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.getSession, sessionId),
  setApprovalMode: (sessionId, mode) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.setApprovalMode, { sessionId, mode }),
  executeFunctionCall: (input) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.executeFunctionCall, input),
  executePlannerStep: (input) => ipcRenderer.invoke(AGENT_RUNTIME_CHANNELS.executePlannerStep, input),
  onEvent: (callback) => subscribeIpcEvent(AGENT_RUNTIME_CHANNELS.event, callback),
}

const checkpointAPI: CheckpointAPI = {
  create: (input) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.create, input),
  finalize: (checkpointId, cwd) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.finalize, { checkpointId, cwd }),
  restore: (checkpointId, cwd, scope) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.restore, { checkpointId, cwd, scope }),
  list: (filter) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.list, filter),
  diff: (checkpointId, filePath, cwd) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.diff, { checkpointId, filePath, cwd }),
  diffAll: (checkpointId, cwd) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.diffAll, { checkpointId, cwd }),
  records: (checkpointId, cwd) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.records, { checkpointId, cwd }),
  delete: (checkpointId, cwd) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.delete, { checkpointId, cwd }),
  clearAll: (cwd) => ipcRenderer.invoke(CHECKPOINT_CHANNELS.clearAll, cwd ? { cwd } : undefined),
  onEvent: (callback) => subscribeIpcEvent(CHECKPOINT_CHANNELS.event, callback),
  onReady: (callback) => subscribeIpcEvent(CHECKPOINT_CHANNELS.ready, callback),
}

const gitAPI: GitAPI = {
  status: (cwd) => ipcRenderer.invoke(GIT_CHANNELS.status, cwd),
  log: (cwd, maxCount) => ipcRenderer.invoke(GIT_CHANNELS.log, cwd, maxCount),
  stage: (cwd, paths) => ipcRenderer.invoke(GIT_CHANNELS.stage, cwd, paths),
  unstage: (cwd, paths) => ipcRenderer.invoke(GIT_CHANNELS.unstage, cwd, paths),
  commit: (cwd, message) => ipcRenderer.invoke(GIT_CHANNELS.commit, cwd, message),
  push: (cwd) => ipcRenderer.invoke(GIT_CHANNELS.push, cwd),
  pull: (cwd) => ipcRenderer.invoke(GIT_CHANNELS.pull, cwd),
  discard: (cwd, relativePath) => ipcRenderer.invoke(GIT_CHANNELS.discard, cwd, relativePath),
  commitChanges: (cwd, hash) => ipcRenderer.invoke(GIT_CHANNELS.commitChanges, cwd, hash),
  fileBaseline: (cwd, relativePath) => ipcRenderer.invoke(GIT_CHANNELS.fileBaseline, cwd, relativePath),
}

const memoAPI: MemoAPI = {
  list: () => ipcRenderer.invoke(MEMO_CHANNELS.list),
  create: title => ipcRenderer.invoke(MEMO_CHANNELS.create, title),
  edit: (id, edit) => ipcRenderer.invoke(MEMO_CHANNELS.edit, id, edit),
  remove: (id, revision) => ipcRenderer.invoke(MEMO_CHANNELS.remove, id, revision),
  onChanged: callback => subscribeIpcEvent(MEMO_CHANNELS.changed, callback),
}

const janusChatAPI: JanusChatAPI = {
  load: () => ipcRenderer.invoke(JANUS_CHAT_CHANNELS.load),
  save: (snapshot) => ipcRenderer.invoke(JANUS_CHAT_CHANNELS.save, snapshot).then(() => undefined),
}

const notificationSettingsAPI: NotificationSettingsAPI = {
  get: () => ipcRenderer.invoke(NOTIFICATION_SETTINGS_CHANNELS.get),
  update: (settings) => ipcRenderer.invoke(NOTIFICATION_SETTINGS_CHANNELS.update, settings),
  testFeishu: (settings) => ipcRenderer.invoke(NOTIFICATION_SETTINGS_CHANNELS.testFeishu, settings),
  getFeishuControlStatus: () => ipcRenderer.invoke(NOTIFICATION_SETTINGS_CHANNELS.feishuControlStatus),
}

const agentSettingsAPI: AgentSettingsAPI = {
  get: () => ipcRenderer.invoke(AGENT_SETTINGS_CHANNELS.get),
  update: (settings) => ipcRenderer.invoke(AGENT_SETTINGS_CHANNELS.update, settings),
}

const experimentalAPI: ExperimentalAPI = {
  get: () => ipcRenderer.invoke(EXPERIMENTAL_CHANNELS.get),
  update: (settings) => ipcRenderer.invoke(EXPERIMENTAL_CHANNELS.update, settings),
}

const themeAPI: ThemeAPI = {
  get: () => ipcRenderer.invoke(THEME_CHANNELS.get),
  update: (theme: AppTheme) => ipcRenderer.invoke(THEME_CHANNELS.update, theme),
  onChanged: (callback) => subscribeIpcEvent<AppTheme>(THEME_CHANNELS.changed, callback),
}

const updaterAPI: UpdaterAPI = {
  getState: () => ipcRenderer.invoke(UPDATER_CHANNELS.getState),
  check: () => ipcRenderer.invoke(UPDATER_CHANNELS.check),
  download: () => ipcRenderer.invoke(UPDATER_CHANNELS.download),
  install: () => ipcRenderer.invoke(UPDATER_CHANNELS.install),
  onEvent: (callback) => subscribeIpcEvent(UPDATER_EVENT_CHANNELS.event, callback),
  getSettings: () => ipcRenderer.invoke(UPDATER_CHANNELS.getSettings),
  updateSettings: (settings) => ipcRenderer.invoke(UPDATER_CHANNELS.updateSettings, settings),
  openReleases: () => ipcRenderer.invoke(UPDATER_CHANNELS.openReleases).then(() => undefined),
  openRepository: () => ipcRenderer.invoke(UPDATER_CHANNELS.openRepository).then(() => undefined),
}

const subAgentRunAPI: SubAgentRunAPI = {
  list: () => ipcRenderer.invoke(SUBAGENT_RUN_CHANNELS.list),
  onUpdated: (callback) => subscribeIpcEvent(SUBAGENT_RUN_CHANNELS.updated, callback),
  onRemoved: (callback) => subscribeIpcEvent(SUBAGENT_RUN_CHANNELS.removed, callback),
}

const teamAPI: TeamAPI = {
  register: (input) => ipcRenderer.invoke(TEAM_CHANNELS.register, input),
  login: (input) => ipcRenderer.invoke(TEAM_CHANNELS.login, input),
  logout: (token) => ipcRenderer.invoke(TEAM_CHANNELS.logout, token),
  refresh: (refreshToken) => ipcRenderer.invoke(TEAM_CHANNELS.refresh, refreshToken),
  me: (token) => ipcRenderer.invoke(TEAM_CHANNELS.me, token),
  listTenants: (token) => ipcRenderer.invoke(TEAM_CHANNELS.listTenants, token),
  createTenant: (token, name) => ipcRenderer.invoke(TEAM_CHANNELS.createTenant, token, name),
  switchTenant: (token, tenantId) => ipcRenderer.invoke(TEAM_CHANNELS.switchTenant, token, tenantId),
  inviteMember: (token, tenantId, role) => ipcRenderer.invoke(TEAM_CHANNELS.inviteMember, token, tenantId, role),
  acceptInvite: (token, code) => ipcRenderer.invoke(TEAM_CHANNELS.acceptInvite, token, code),
  listMembers: (token, tenantId) => ipcRenderer.invoke(TEAM_CHANNELS.listMembers, token, tenantId),
  listProjects: (token, tenantId) => ipcRenderer.invoke(TEAM_CHANNELS.listProjects, token, tenantId),
  setRole: (token, tenantId, userId, role) => ipcRenderer.invoke(TEAM_CHANNELS.setRole, token, tenantId, userId, role),
  setMemberStatus: (token, tenantId, userId, status) =>
    ipcRenderer.invoke(TEAM_CHANNELS.setMemberStatus, token, tenantId, userId, status),
}

const remoteAPI: RemoteAPI = {
  status: () => ipcRenderer.invoke(REMOTE_CHANNELS.status),
  start: (options) => ipcRenderer.invoke(REMOTE_CHANNELS.start, options),
  stop: () => ipcRenderer.invoke(REMOTE_CHANNELS.stop),
  approve: (id) => ipcRenderer.invoke(REMOTE_CHANNELS.approve, id),
  reject: () => ipcRenderer.invoke(REMOTE_CHANNELS.reject),
  revoke: (id) => ipcRenderer.invoke(REMOTE_CHANNELS.revoke, id),
}

const dialogAPI: DialogAPI = {
  openDirectory: () => ipcRenderer.invoke(SYSTEM_CHANNELS.openDirectory),
  saveFile: (options) => ipcRenderer.invoke(SYSTEM_CHANNELS.saveFile, options),
  showMessageBox: (options) => ipcRenderer.invoke(SYSTEM_CHANNELS.showMessageBox, options),
}
const windowAPI: WindowAPI = {
  getMaximized: () => ipcRenderer.invoke(SYSTEM_CHANNELS.getMaximized),
  onMaximizedChanged: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.maximizedChanged, callback),
  minimize: () => ipcRenderer.invoke(SYSTEM_CHANNELS.minimize),
  maximize: () => ipcRenderer.invoke(SYSTEM_CHANNELS.maximize),
  close: () => ipcRenderer.invoke(SYSTEM_CHANNELS.close),
  openEditor: (payload) => ipcRenderer.invoke(SYSTEM_CHANNELS.openEditor, payload),
  editorHostReady: () => ipcRenderer.send(SYSTEM_CHANNELS.editorHostReady),
  editorReceived: (requestId, success) => ipcRenderer.send(SYSTEM_CHANNELS.editorReceived, { requestId, success }),
  editorReady: () => ipcRenderer.send(SYSTEM_CHANNELS.editorReady),
  onEditorCloseRequested: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.requestEditorClose, callback),
  confirmEditorClose: () => ipcRenderer.invoke(SYSTEM_CHANNELS.confirmEditorClose),
  reportEditorViewed: (payload) => ipcRenderer.send(SYSTEM_CHANNELS.editorViewed, payload),
  onEditorViewed: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.editorViewed, callback),
  embedEditor: (payload) => ipcRenderer.invoke(SYSTEM_CHANNELS.embedEditor, payload),
  setAlwaysOnTop: (value) => ipcRenderer.invoke(SYSTEM_CHANNELS.setAlwaysOnTop, value),
  onEditorEmbedded: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.editorEmbedded, callback),
  onEditorRefresh: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.refreshEditor, callback),
}
const shellProfilesAPI: ShellProfilesAPI = {
  list: () => ipcRenderer.invoke(SHELL_PROFILE_CHANNELS.list),
  save: (settings) => ipcRenderer.invoke(SHELL_PROFILE_CHANNELS.save, settings),
  detect: () => ipcRenderer.invoke(SHELL_PROFILE_CHANNELS.detect),
}
const systemAPI: SystemAPI = {
  getDefaultShell: () => ipcRenderer.invoke(SYSTEM_CHANNELS.defaultShell),
  getPlatform: () => ipcRenderer.invoke(SYSTEM_CHANNELS.platform),
  openVSCode: (workspacePath) => ipcRenderer.invoke(SYSTEM_CHANNELS.openVSCode, workspacePath),
  getRuntimeTelemetry: (request) => ipcRenderer.invoke(SYSTEM_CHANNELS.runtimeTelemetry, request),
  listUsageLedger: (query) => ipcRenderer.invoke(SYSTEM_CHANNELS.usageLedger, query),
  getLanguage: () => ipcRenderer.invoke(SYSTEM_CHANNELS.getLanguage),
  setLanguage: (lang) => ipcRenderer.invoke(SYSTEM_CHANNELS.setLanguage, lang),
  onPrepareQuit: (callback) => {
    const handler = async () => {
      await callback()
      ipcRenderer.send(SYSTEM_CHANNELS.prepareQuitAck)
    }
    ipcRenderer.on(SYSTEM_CHANNELS.prepareQuit, handler)
    return () => ipcRenderer.removeListener(SYSTEM_CHANNELS.prepareQuit, handler)
  },
}
const sessionAPI: SessionAPI = {
  list: (filter) => ipcRenderer.invoke(SESSION_CHANNELS.list, filter),
  get: (sessionId) => ipcRenderer.invoke(SESSION_CHANNELS.get, { sessionId }),
  continue: (input) => ipcRenderer.invoke(SESSION_CHANNELS.continue, input),
  resendHandoff: (sessionId) => ipcRenderer.invoke(SESSION_CHANNELS.resendHandoff, { sessionId }),
  onEvent: (callback) => subscribeIpcEvent(SESSION_CHANNELS.event, callback),
  scanExternal: () => ipcRenderer.invoke(SESSION_CHANNELS.scanExternal),
  getTranscript: (sessionId) => ipcRenderer.invoke(SESSION_CHANNELS.getTranscript, { sessionId }),
  saveLayout: (layout) => ipcRenderer.invoke(SESSION_CHANNELS.saveLayout, layout),
  getLayout: () => ipcRenderer.invoke(SESSION_CHANNELS.getLayout),
  clearLayout: () => ipcRenderer.invoke(SESSION_CHANNELS.clearLayout),
}

const worktreeAPI: WorktreeAPI = {
  list: (workspaceId, workspacePath) => ipcRenderer.invoke(WORKTREE_CHANNELS.list, { workspaceId, workspacePath }),
  identity: (workspacePath) => ipcRenderer.invoke(WORKTREE_CHANNELS.identity, { workspacePath }),
  avatar: (workspacePath) => ipcRenderer.invoke(WORKTREE_CHANNELS.avatar, { workspacePath }),
  create: (input) => ipcRenderer.invoke(WORKTREE_CHANNELS.create, input),
  cancelCreate: (creationId, workspacePath) =>
    ipcRenderer.invoke(WORKTREE_CHANNELS.cancelCreate, { creationId, workspacePath }),
  delete: (input) => ipcRenderer.invoke(WORKTREE_CHANNELS.delete, input),
  status: (worktreePath) => ipcRenderer.invoke(WORKTREE_CHANNELS.status, { worktreePath }),
  deleteBranch: (workspacePath, branch, force) =>
    ipcRenderer.invoke(WORKTREE_CHANNELS.deleteBranch, { workspacePath, branch, force }),
  shipDiff: (workspacePath, base, branch) =>
    ipcRenderer.invoke(WORKTREE_CHANNELS.shipDiff, { workspacePath, base, branch }),
  shipMerge: (workspacePath, branch) => ipcRenderer.invoke(WORKTREE_CHANNELS.shipMerge, { workspacePath, branch }),
  shipAbort: (workspacePath) => ipcRenderer.invoke(WORKTREE_CHANNELS.shipAbort, { workspacePath }),
  unwatch: (workspaceId, workspacePath) =>
    ipcRenderer.invoke(WORKTREE_CHANNELS.unwatch, { workspaceId, workspacePath }),
  onChanged: (callback) => subscribeIpcEvent(WORKTREE_CHANNELS.changed, callback),
}

const hostedAPI: HostedAPI = {
  detect: (workspacePath) => ipcRenderer.invoke(HOSTED_CHANNELS.detect, { workspacePath }),
  listReviews: (workspacePath, branch) => ipcRenderer.invoke(HOSTED_CHANNELS.listReviews, { workspacePath, branch }),
  checks: (workspacePath, branch) => ipcRenderer.invoke(HOSTED_CHANNELS.checks, { workspacePath, branch }),
  failedLogs: (workspacePath, branch) => ipcRenderer.invoke(HOSTED_CHANNELS.failedLogs, { workspacePath, branch }),
  createReview: (input) => ipcRenderer.invoke(HOSTED_CHANNELS.createReview, input),
  mergeReview: (workspacePath, number, method) =>
    ipcRenderer.invoke(HOSTED_CHANNELS.mergeReview, { workspacePath, number, method }),
  gitlabGet: () => ipcRenderer.invoke(HOSTED_CHANNELS.gitlabGet),
  gitlabSave: (input) => ipcRenderer.invoke(HOSTED_CHANNELS.gitlabSave, input),
  gitlabVerify: (input) => ipcRenderer.invoke(HOSTED_CHANNELS.gitlabVerify, input),
  gitlabClearToken: () => ipcRenderer.invoke(HOSTED_CHANNELS.gitlabClearToken),
  listIssues: (workspacePath, query) => ipcRenderer.invoke(HOSTED_CHANNELS.listIssues, { workspacePath, query }),
  listComments: (workspacePath, number) => ipcRenderer.invoke(HOSTED_CHANNELS.listComments, { workspacePath, number }),
  postComment: (workspacePath, number, body) =>
    ipcRenderer.invoke(HOSTED_CHANNELS.postComment, { workspacePath, number, body }),
  setAutoMerge: (workspacePath, number, enable) =>
    ipcRenderer.invoke(HOSTED_CHANNELS.setAutoMerge, { workspacePath, number, enable }),
}

const desktopToastAPI: DesktopToastAPI = {
  ready: () => ipcRenderer.send(SYSTEM_CHANNELS.toastReady),
  action: (action) => ipcRenderer.send(SYSTEM_CHANNELS.toastAction, { action }),
  onShow: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.toastShow, callback),
  onHide: (callback) => subscribeIpcEvent(SYSTEM_CHANNELS.toastHide, callback),
}

const pluginAPI: PluginHostAPI = {
  request: input => ipcRenderer.invoke(PLUGIN_CHANNELS.manage, input),
  onChanged: callback => subscribeIpcEvent(PLUGIN_CHANNELS.changed, callback),
  onEvent: callback => subscribeIpcEvent(PLUGIN_CHANNELS.event, callback),
}

contextBridge.exposeInMainWorld('electron', {
  /*-- 同步暴露平台与 Windows build 号，供渲染端构造 xterm windowsPty 用 --*/
  /*-- preload 在 Node 环境，可同步读取；os.release() 形如 "10.0.22621"，第三段为 build 号 --*/
  platform: process.platform,
  windowsBuild:
    process.platform === 'win32' ? Number(os.release().split('.')[2]) || undefined : undefined,

  /*-- Janus 人格 prompt 单一来源：主进程 Analyzer 与渲染层 JanusChat 共用 --*/
  janusPersona: JANUS_PERSONA,
  workspace: workspaceAPI,
  workspaceRuntime: workspaceRuntimeAPI,
  fileTree: fileTreeAPI,
  file: fileAPI,
  terminal: terminalAPI,
  project: projectAPI,
  browser: browserAPI,
  plugins: pluginAPI,
  knowledge: knowledgeAPI,
  janus: janusAPI,
  harness: harnessAPI,
  blueprintReview: blueprintReviewAPI,
  office: officeAPI,
  llm: llmAPI,
  externalCli: externalCliAPI,
  workflowx: workflowxAPI,
  janusChat: janusChatAPI,
  memo: memoAPI,
  roundtable: roundtableAPI,
  agent: agentAPI,
  agentRuntime: agentRuntimeAPI,
  checkpoint: checkpointAPI,
  session: sessionAPI,
  worktree: worktreeAPI,
  hosted: hostedAPI,
  git: gitAPI,
  notificationSettings: notificationSettingsAPI,
  agentSettings: agentSettingsAPI,
  experimental: experimentalAPI,
  theme: themeAPI,
  updater: updaterAPI,
  subAgentRun: subAgentRunAPI,
  team: teamAPI,
  remote: remoteAPI,
  dialog: dialogAPI,
  window: windowAPI,
  system: systemAPI,
  shellProfiles: shellProfilesAPI,
  desktopToast: desktopToastAPI,
})
