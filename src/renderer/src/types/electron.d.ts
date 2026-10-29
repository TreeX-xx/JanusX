import type { FileAPI, FileTreeAPI, WorkspaceAPI } from '../../../shared/ipc/workspace'
import type { WorkspaceRuntimeAPI } from '../../../shared/workspace-runtime'
import type { TerminalAPI } from '../../../shared/ipc/terminal'
import type { ProjectAPI } from '../../../shared/ipc/project'
import type { BrowserAPI } from '../../../shared/ipc/browser'
import type { PluginHostAPI } from '../../../shared/ipc/plugins'
import type { KnowledgeAPI } from '../../../shared/ipc/knowledge'
import type { JanusAPI } from '../../../shared/ipc/janus'
import type { HarnessAPI } from '../../../shared/ipc/harness'
import type { BlueprintReviewAPI } from '../../../../plugins/blueprint/src/shared/ipc/blueprint-review'
import type { OfficeAPI } from '../../../shared/office'
import type { AgentAPI, SubAgentRunAPI } from '../../../shared/ipc/janus-runner'
import type { AgentRuntimeAPI } from '../../../shared/ipc/agent-runtime'
import type { CheckpointAPI } from '../../../shared/ipc/checkpoint'
import type { SessionAPI } from '../../../shared/ipc/session'
import type { WorktreeAPI } from '../../../shared/ipc/worktree'
import type { HostedAPI } from '../../../shared/ipc/hosted'
import type { GitAPI } from '../../../shared/ipc/git'
import type { LlmAPI } from '../../../shared/ipc/llm'
import type { ExternalCliAPI } from '../../../shared/ipc/external-cli'
import type { WorkflowXAPI } from '../../../shared/ipc/workflowx'
import type { JanusChatAPI } from '../../../shared/ipc/janus-chat'
import type { MemoAPI } from '../../../shared/ipc/memo'
import type { RoundtableAPI } from '../../../shared/ipc/roundtable'
import type { AgentSettingsAPI, NotificationSettingsAPI } from '../../../shared/ipc/settings'
import type { ExperimentalAPI } from '../../../shared/ipc/experimental'
import type { ThemeAPI } from '../../../shared/ipc/theme'
import type { DesktopToastAPI, DialogAPI, SystemAPI, WindowAPI } from '../../../shared/ipc/system'
import type { TeamAPI } from '../../../shared/ipc/team'
import type { ShellProfilesAPI } from '../../../shared/ipc/shell-profiles'
import type { UpdaterAPI } from '../../../shared/ipc/updater'
import type { RemoteAPI } from '../../../shared/ipc/remote'

interface ElectronAPI {
  /*-- 同步平台信息，构造 xterm windowsPty 用 --*/
  platform: NodeJS.Platform
  windowsBuild?: number
  workspace: WorkspaceAPI
  workspaceRuntime?: WorkspaceRuntimeAPI
  fileTree: FileTreeAPI
  file: FileAPI
  terminal: TerminalAPI
  project: ProjectAPI
  browser: BrowserAPI
  plugins?: PluginHostAPI
  knowledge: KnowledgeAPI
  janus: JanusAPI
  harness: HarnessAPI
  blueprintReview: BlueprintReviewAPI
  office: OfficeAPI
  llm: LlmAPI
  externalCli: ExternalCliAPI
  workflowx: WorkflowXAPI
  janusChat?: JanusChatAPI
  memo?: MemoAPI
  roundtable: RoundtableAPI
  agent: AgentAPI
  agentRuntime: AgentRuntimeAPI
  checkpoint: CheckpointAPI
  session: SessionAPI
  worktree: WorktreeAPI
  hosted: HostedAPI
  git: GitAPI
  notificationSettings: NotificationSettingsAPI
  agentSettings: AgentSettingsAPI
  experimental: ExperimentalAPI
  theme: ThemeAPI
  updater: UpdaterAPI
  subAgentRun: SubAgentRunAPI
  team: TeamAPI
  remote: RemoteAPI
  dialog: DialogAPI
  window: WindowAPI
  system: SystemAPI
  shellProfiles: ShellProfilesAPI
  desktopToast: DesktopToastAPI
  janusPersona: string
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
