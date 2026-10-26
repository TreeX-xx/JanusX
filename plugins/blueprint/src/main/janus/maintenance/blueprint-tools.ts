import { z } from 'zod'
import type { Blueprint } from '../../../shared/janus/types'
import type { BlueprintOperation } from '../../../shared/janus/maintenance-types'
import type { JanusAgentTool } from '@janus-agent/agent-core'
import { normalizeProposedOperations } from './changeset'

const operationBase = {
  operationId: z.string().min(1),
  reason: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
}

const relationType = z.enum(['depends-on', 'blocks', 'related-to', 'implements'])
const proposedFeature = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().default(''),
  progress: z.number().min(0).max(100).default(0),
  status: z.enum(['planned', 'in-progress', 'done', 'blocked']).default('planned'),
  requirementNotes: z.array(z.string()).default([]),
})

export const blueprintProposalSchema = z.object({
  summary: z.string().min(1),
  operations: z.array(z.discriminatedUnion('type', [
    z.object({ ...operationBase, type: z.literal('create-node'), tempNodeId: z.string().min(1), parentId: z.string().min(1), after: z.object({
      title: z.string().min(1), type: z.enum(['epic', 'feature', 'task', 'issue']), description: z.string().default(''),
      positioning: z.string().default(''), techSolution: z.string().default(''), notes: z.string().default(''), tags: z.array(z.string()).default([]),
    }) }),
    z.object({ ...operationBase, type: z.literal('update-node'), nodeId: z.string().min(1), after: z.object({
      title: z.string().min(1).optional(), type: z.enum(['epic', 'feature', 'task', 'issue']).optional(),
      status: z.enum(['not-started', 'in-progress', 'testing', 'done', 'blocked']).optional(), progress: z.number().min(0).max(100).optional(),
      positioning: z.string().optional(), description: z.string().optional(), techSolution: z.string().optional(), notes: z.string().optional(), tags: z.array(z.string()).optional(),
      features: z.array(proposedFeature).max(40).optional(),
      sections: z.record(z.string().min(1).regex(/^[^\r\n#]+$/), z.string()).optional(),
    }) }),
    z.object({ ...operationBase, type: z.literal('move-node'), nodeId: z.string().min(1), afterParentId: z.string().min(1) }),
    z.object({ ...operationBase, type: z.literal('add-relation'), tempRelationId: z.string().min(1), after: z.object({
      sourceNodeId: z.string().min(1), targetNodeId: z.string().min(1), relationType, description: z.string().optional(),
    }) }),
    z.object({ ...operationBase, type: z.literal('update-relation'), relationId: z.string().min(1), after: z.object({
      relationType: relationType.optional(), description: z.string().optional(),
    }) }),
    z.object({ ...operationBase, type: z.literal('remove-relation'), relationId: z.string().min(1) }),
    z.object({ ...operationBase, type: z.literal('update-workspace-binding'), nodeId: z.string().min(1), after: z.object({
      primaryWorkspaceId: z.string().min(1).nullable(), linkedWorkspaceIds: z.array(z.string().min(1)).default([]),
    }) }),
    z.object({ ...operationBase, type: z.literal('archive-node'), nodeId: z.string().min(1) }),
    z.object({ ...operationBase, type: z.literal('delete-node'), nodeId: z.string().min(1) }),
  ])).max(60),
})

export function blueprintNodeContext(blueprint: Blueprint, allowed: Set<string>, includeContent = true): string {
  const nodes = [...allowed].map((id) => {
    const node = blueprint.nodes[id]
    return node && {
      id: node.id, title: node.title, type: node.type, status: node.status, progress: node.progress,
      ...(includeContent ? { positioning: node.positioning, description: node.description, techSolution: node.techSolution, notes: node.notes } : {}),
      sourceUri: node.sourceUri, tags: node.tags, parentId: node.parentId, children: node.children,
      primaryWorkspaceId: node.primaryWorkspaceId, linkedWorkspaceIds: node.linkedWorkspaceIds,
    }
  }).filter(Boolean)
  // Relations touching the scope are readable context even when the far endpoint is out of scope.
  const relations = (blueprint.relations ?? [])
    .filter((relation) => allowed.has(relation.sourceNodeId) || allowed.has(relation.targetNodeId))
    .map((relation) => ({
      id: relation.id, type: relation.type, description: relation.description,
      sourceNodeId: relation.sourceNodeId, targetNodeId: relation.targetNodeId,
      sourceTitle: blueprint.nodes[relation.sourceNodeId]?.title,
      targetTitle: blueprint.nodes[relation.targetNodeId]?.title,
      sourceInScope: allowed.has(relation.sourceNodeId),
      targetInScope: allowed.has(relation.targetNodeId),
    }))
  return JSON.stringify({ nodes, relations }, null, includeContent ? 2 : undefined)
}

/**
 * ViewPatch: the only thing the Agent may change about the canvas itself.
 * Overlay-only (layout coordinates, subtree collapse, focus) — never note
 * content. `.strict()` rejects raw file-edit fields (title/features/status/…).
 */
export const blueprintViewPatchSchema = z.object({
  summary: z.string().min(1).max(500),
  layout: z.record(
    z.string().min(1),
    z.object({
      x: z.number().finite().min(-100000).max(100000),
      y: z.number().finite().min(-100000).max(100000),
    }),
  ).optional(),
  collapsedNodeIds: z.array(z.string().min(1)).max(500).nullable().optional(),
  focusNodeId: z.string().min(1).nullable().optional(),
}).strict()

export type BlueprintViewPatch = z.infer<typeof blueprintViewPatchSchema>

const VIEW_PATCH_LAYOUT_LIMIT = 200

/**
 * Validates a ViewPatch against the live blueprint scope. Unknown node ids,
 * oversized layouts, and out-of-scope focus fail closed with a coded error;
 * content fields never reach here (the strict schema drops them at parse).
 */
export function validateViewPatch(
  blueprint: Blueprint,
  input: unknown,
): { ok: true; patch: BlueprintViewPatch } | { ok: false; code: string; message: string } {
  let parsed: BlueprintViewPatch
  try {
    parsed = blueprintViewPatchSchema.parse(input)
  } catch (err) {
    return { ok: false, code: 'SCHEMA_INVALID', message: err instanceof Error ? err.message : String(err) }
  }
  const known = new Set(blueprint.nodeIds)
  const layoutKeys = Object.keys(parsed.layout ?? {})
  if (layoutKeys.length > VIEW_PATCH_LAYOUT_LIMIT) {
    return { ok: false, code: 'SCHEMA_INVALID', message: `layout covers ${layoutKeys.length} nodes, limit is ${VIEW_PATCH_LAYOUT_LIMIT}` }
  }
  for (const id of layoutKeys) {
    if (!known.has(id)) return { ok: false, code: 'NOT_FOUND', message: `unknown layout node: ${id}` }
  }
  for (const id of parsed.collapsedNodeIds ?? []) {
    if (!known.has(id)) return { ok: false, code: 'NOT_FOUND', message: `unknown collapse node: ${id}` }
  }
  if (parsed.focusNodeId != null && !known.has(parsed.focusNodeId)) {
    return { ok: false, code: 'NOT_FOUND', message: `unknown focus node: ${parsed.focusNodeId}` }
  }
  return { ok: true, patch: parsed }
}

/**
 * Pure overlay merge: layout entries overwrite per node, collapse replaces
 * only when present, focus travels as metadata for the host. No IO — the
 * caller persists through the existing canvasLayout/collapsedNodeIds overlay
 * paths (local-only, never note bytes).
 */
export function applyViewPatch(
  blueprint: Blueprint,
  patch: BlueprintViewPatch,
): { canvasLayout: Blueprint['canvasLayout']; collapsedNodeIds: Blueprint['collapsedNodeIds']; focusNodeId: string | null } {
  return {
    canvasLayout: { ...blueprint.canvasLayout, ...(patch.layout ?? {}) },
    collapsedNodeIds: patch.collapsedNodeIds !== undefined ? patch.collapsedNodeIds : blueprint.collapsedNodeIds,
    focusNodeId: patch.focusNodeId ?? null,
  }
}

export function createJanusBlueprintTools(options: {
  readOnlyTools?: JanusAgentTool[]
  blueprint: Blueprint
  allowedNodeIds: Set<string>
}): JanusAgentTool[] {
  const read: JanusAgentTool = {
    name: 'janus.blueprint.read',
    executionMode: 'parallel',
    execute: async () => ({
      content: blueprintNodeContext(options.blueprint, options.allowedNodeIds),
      details: { blueprintId: options.blueprint.id, contentRevision: options.blueprint.contentRevision },
    }),
  }
  const propose: JanusAgentTool = {
    name: 'janus.blueprint.propose',
    executionMode: 'sequential',
    execute: async (call) => {
      const input = blueprintProposalSchema.parse(call.arguments)
      const operations = normalizeProposedOperations(
        options.blueprint,
        new Set(options.allowedNodeIds),
        input.operations as BlueprintOperation[],
      )
      return {
        content: JSON.stringify({ summary: input.summary, operations }),
        details: { summary: input.summary, operations },
      }
    },
  }
  const view: JanusAgentTool = {
    name: 'janus.blueprint.view',
    executionMode: 'parallel',
    execute: async (call) => {
      const checked = validateViewPatch(options.blueprint, call.arguments)
      if (!checked.ok) throw new Error(`${checked.code}: ${checked.message}`)
      const applied = applyViewPatch(options.blueprint, checked.patch)
      return {
        content: JSON.stringify({ summary: checked.patch.summary, ...applied }),
        details: { summary: checked.patch.summary, ...applied },
      }
    },
  }
  return [...(options.readOnlyTools ?? []), read, propose, view]
}

export const blueprintReadModelTool = {
  description: 'Read the authorized Blueprint node scope, including exact node IDs and parent-child structure.',
  parameters: z.object({}),
}
