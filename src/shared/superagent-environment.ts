/** Host-owned Git identities. Paths are resolved from the registered workspace, never UI selection. */
export interface SuperAgentCheckout {
  path: string
  commonDir: string
  gitDir: string
  repositoryIdentity: string
  directoryIdentity: string
  branch: string
  head: string
  dirty: boolean
  /** Ignored paths are included in a directory removal; they are not silently described as absent. */
  ignoredEntries: string[]
  locked: boolean
  isMain: boolean
  operationInProgress: boolean
}

export interface SuperAgentEnvironment {
  id: string
  workspaceId: string
  workId: string
  workspacePath: string
  checkout: SuperAgentCheckout
  baseRef: string
  baseCommit: string
  createdAt: number
  removedAt: number | null
}

export type SuperAgentGitPlan =
  | { kind: 'create'; source: SuperAgentCheckout; targetPath: string; branch: string; baseRef: string; baseCommit: string; setup: 'isolated' }
  | { kind: 'merge'; source: SuperAgentCheckout; target: SuperAgentCheckout; environmentId: string; strategy: 'no-ff' }
  | { kind: 'remove'; source: SuperAgentCheckout; target: SuperAgentCheckout; environmentId: string; unmergedCommits: number; preserveBranch: true; force: false }

export interface SuperAgentGitOperation {
  id: string
  workspaceId: string
  workId: string
  workRevision: number
  plan: SuperAgentGitPlan
  createdAt: number
  expiresAt: number
  status: 'pending' | 'rejected' | 'stale' | 'executing' | 'succeeded' | 'failed' | 'unknown'
  decidedAt: number | null
  finishedAt: number | null
  message: string | null
}

export interface SuperAgentEnvironmentSnapshot {
  workspaceId: string
  revision: number
  environments: SuperAgentEnvironment[]
  operations: SuperAgentGitOperation[]
}

export interface SuperAgentEnvironmentChange { workspaceId: string; revision: number }

export interface SuperAgentEnvironmentDecision {
  workspaceId: string
  operationId: string
  approved: boolean
}
