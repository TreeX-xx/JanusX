export type {
  AppLoadState,
  CLIConfig,
  FileNode,
  LayoutConfig,
  LayoutPosition,
  TerminalPreset,
  Workspace,
  WorkspaceSidebarGroup,
} from '../../../shared/ipc/workspace'

import type { TerminalPreset } from '../../../shared/ipc/workspace'
import type { TerminalStatus } from '../../../shared/ipc/terminal'
import type {
  RuntimeTelemetryConfidence,
  RuntimeTelemetrySource,
} from '../../../shared/ipc/system'

export type { TerminalStatus }

export interface Terminal {
  id: string
  workspaceId: string
  name: string
  preset: TerminalPreset
  cwd: string
  shell: string
  autoCommand?: string
  pid: number | null
  status: TerminalStatus
  updatedAt?: number
  telemetryStartedAt?: number
  exitCode?: number
  errorMessage?: string
  detectedModel?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  contextTokens?: number
  contextWindowTokens?: number
  telemetrySessionId?: string
  telemetrySessionBinding?: 'exact' | 'correlated'
  telemetrySource?: RuntimeTelemetrySource
  telemetryConfidence?: RuntimeTelemetryConfidence
  telemetryUpdatedAt?: number
  compactionCount?: number
  compactionCountConfidence?: 'exact'
  modelChangedAt?: number
}

// ── Git types ──

export interface GitBranch {
  name: string
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitFileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '??' | 'UU'
  staged: boolean
  additions: number | null
  deletions: number | null
}

export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

export interface GitStatus {
  /** false 表示该工作区不是 Git 仓库（主进程结构化返回，不是错误）。 */
  isRepo?: boolean
  branch: GitBranch
  changes: GitFileChange[]
  clean: boolean
}

// ── File Editor types ──

export type { FileViewType, OpenFile } from '../../../shared/editor'
