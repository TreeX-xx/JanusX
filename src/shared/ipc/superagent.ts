import type {
  SuperAgentChange, SuperAgentInputReceipt, SuperAgentResourceContent,
  SuperAgentSnapshot, SuperAgentSubmitInput, SuperAgentWorkDetail,
} from '../superagent'
import type { SuperAgentEnvironmentChange, SuperAgentEnvironmentDecision, SuperAgentEnvironmentSnapshot, SuperAgentGitOperation } from '../superagent-environment'
import type { SuperAgentAppendInput, SuperAgentContinueInput, SuperAgentNativeLog, SuperAgentPreparedWork, SuperAgentWorkerControl, SuperAgentWorkerSnapshot } from '../superagent-worker'
import type { SuperAgentQueueControl, SuperAgentScheduleEntry, SuperAgentScheduleSnapshot, SuperAgentWorkControl } from '../superagent-scheduling'
import type { WorkerModelSettings, WorkerSettingsIdentity, WorkerSettingsState } from '../superagent-worker-settings'
import type { WorkerPolicy } from '../superagent-worker-settings'
import type { SuperAgentWorkflow, SuperAgentWorkflowControl, SuperAgentWorkflowSnapshot } from '../superagent-workflow'

export const SUPERAGENT_CHANNELS = {
  available: 'superagent:available',
  workerModels: 'superagent:worker-models',
  workflows: 'superagent:workflows',
  controlWorkflow: 'superagent:control-workflow',
  workflowsChanged: 'superagent:workflows-changed',
  workerPolicy: 'superagent:worker-policy',
  updateWorkerPolicy: 'superagent:update-worker-policy',
  workerDefaults: 'superagent:worker-defaults',
  workerIdleTimeoutMinutes: 'superagent:worker-idle-timeout-minutes',
  updateWorkerIdleTimeoutMinutes: 'superagent:update-worker-idle-timeout-minutes',
  updateWorkerDefaults: 'superagent:update-worker-defaults',
  workerSettings: 'superagent:worker-settings',
  configureWorker: 'superagent:configure-worker',
  refreshWorkerModels: 'superagent:refresh-worker-models',
  submitInput: 'superagent:submit-input',
  snapshot: 'superagent:snapshot',
  workDetail: 'superagent:work-detail',
  readResource: 'superagent:read-resource',
  changed: 'superagent:changed',
  environments: 'superagent:environments',
  decideEnvironmentOperation: 'superagent:decide-environment-operation',
  environmentsChanged: 'superagent:environments-changed',
  prepareWorker: 'superagent:prepare-worker',
  startWorker: 'superagent:start-worker',
  appendWorker: 'superagent:append-worker',
  continueWorker: 'superagent:continue-worker',
  workers: 'superagent:workers',
  controlWorker: 'superagent:control-worker',
  workerChanged: 'superagent:worker-changed',
  workerLog: 'superagent:worker-log',
  schedule: 'superagent:schedule',
  configureCapacity: 'superagent:configure-capacity',
  controlWork: 'superagent:control-work',
  controlQueue: 'superagent:control-queue',
  scheduleChanged: 'superagent:schedule-changed',
} as const

/** Renderer can submit user input and read records, never forge worker reports or delivery. */
export interface SuperAgentAPI {
  available(): Promise<boolean>
  workerModels(backend: 'codex' | 'claude'): Promise<import('../conversation-display').ConversationModelOption[]>
  workflows(workspaceId: string): Promise<SuperAgentWorkflowSnapshot>
  controlWorkflow(control: SuperAgentWorkflowControl): Promise<SuperAgentWorkflow>
  onWorkflowsChanged(callback: (change: { workspaceId: string }) => void): () => void
  workerPolicy(): Promise<WorkerPolicy>
  updateWorkerPolicy(policy: WorkerPolicy): Promise<WorkerPolicy>
  workerDefaults(backend?: 'codex' | 'claude'): Promise<WorkerModelSettings>
  workerIdleTimeoutMinutes(): Promise<number>
  updateWorkerIdleTimeoutMinutes(minutes: number): Promise<number>
  updateWorkerDefaults(settings: WorkerModelSettings): Promise<WorkerModelSettings>
  workerSettings(identity: WorkerSettingsIdentity): Promise<WorkerSettingsState>
  configureWorker(identity: WorkerSettingsIdentity, settings: WorkerModelSettings | null): Promise<WorkerSettingsState>
  refreshWorkerModels(identity: WorkerSettingsIdentity): Promise<WorkerSettingsState>
  submitInput(input: SuperAgentSubmitInput): Promise<SuperAgentInputReceipt>
  snapshot(workspaceId: string): Promise<SuperAgentSnapshot>
  workDetail(workspaceId: string, workId: string): Promise<SuperAgentWorkDetail>
  readResource(workspaceId: string, resourceId: string): Promise<SuperAgentResourceContent>
  onChanged(callback: (change: SuperAgentChange) => void): () => void
  environments(workspaceId: string): Promise<SuperAgentEnvironmentSnapshot>
  decideEnvironmentOperation(decision: SuperAgentEnvironmentDecision): Promise<SuperAgentGitOperation>
  onEnvironmentsChanged(callback: (change: SuperAgentEnvironmentChange) => void): () => void
  prepareWorker(input: SuperAgentSubmitInput): Promise<SuperAgentPreparedWork>
  startWorker(workspaceId: string, workId: string): Promise<SuperAgentScheduleEntry>
  appendWorker(input: SuperAgentAppendInput): Promise<SuperAgentWorkerSnapshot>
  continueWorker(input: SuperAgentContinueInput): Promise<SuperAgentPreparedWork>
  workers(workspaceId: string): Promise<SuperAgentWorkerSnapshot[]>
  controlWorker(control: SuperAgentWorkerControl): Promise<SuperAgentWorkerSnapshot>
  onWorkerChanged(callback: (snapshot: SuperAgentWorkerSnapshot) => void): () => void
  workerLog(workspaceId: string, executionId: string): Promise<SuperAgentNativeLog>
  schedule(workspaceId: string): Promise<SuperAgentScheduleSnapshot>
  configureCapacity(maxConcurrentWorkers: number): Promise<number>
  controlWork(control: SuperAgentWorkControl): Promise<unknown>
  controlQueue(control: SuperAgentQueueControl): Promise<SuperAgentScheduleSnapshot>
  onScheduleChanged(callback: (change: { workspaceId: string }) => void): () => void
}
