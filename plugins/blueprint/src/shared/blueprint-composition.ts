import type { CodeRef, NoteInterface, TaskExecution } from '@janus-agent/harness-core'
import type { NoteReadSnapshot } from '@janus-agent/harness-node'

export type CompositionStatus = 'bound' | 'unbound' | 'stale'
export interface CompositionNode {
  layer: 'skeleton' | 'evidence'
  status: CompositionStatus
  repoId: string | null
  checkoutId?: string
  path: string
  sourceUri?: string
  binding?: { repoId: string; checkoutId: string; path: string }
}
export interface CompositionCheckout {
  repoId: string | null
  checkoutId: string
  path: string
  selected?: boolean
  name?: string
  revision: number | null
  status: CompositionStatus
  dirty?: boolean
  diagnostic?: string
  nodeIds: string[]
  snapshot?: NoteReadSnapshot
}
export interface CompositionInterface {
  id: string
  nodeId: string
  name: string
  direction: NoteInterface['direction']
  provider?: string
  providerNodeId?: string
  status: 'connected' | 'dangling' | 'idle' | 'unbound' | 'stale'
}
export interface CompositionEvidence {
  nodeId: string
  sourceUri?: string
  sourceHash?: string
  codeRefs: CodeRef[]
  execution?: TaskExecution
}
export interface CompositionDiagnostic { code: string; message: string; nodeId?: string; checkoutId?: string; sourceUri?: string }

/** Read-only derived DTO. Source snapshots remain isolated by checkout. */
export interface BlueprintComposition {
  version: 'r4'
  checkouts: CompositionCheckout[]
  nodes: Record<string, CompositionNode>
  interfaces: CompositionInterface[]
  evidence: CompositionEvidence[]
  diagnostics: CompositionDiagnostic[]
}
