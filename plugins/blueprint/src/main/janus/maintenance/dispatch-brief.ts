/**
 * @file Dispatch brief — the conversation's hand-off into a work terminal.
 * @description Dispatch is deliberately NOT a BlueprintOperation: the change set
 *  is content-only (see `changeset.ts` exhaustive switches and the persisted
 *  audit JSON), and reversing a terminal launch has no meaning. So the brief is
 *  a standalone structured generation over the same authorized maintenance
 *  task, and the host — not the Agent — performs the launch.
 *
 *  The brief text is rendered here, in main, so what the terminal receives is
 *  one auditable function rather than a template assembled in the renderer.
 *  See .agents/notes/blueprint/maintenance/blueprint-dispatch-panel.md
 */
import { z } from 'zod'
import type { BlueprintMaintenanceScope } from '../../../shared/janus/maintenance-types'

/** Bounded so one dispatch cannot blow the terminal's first prompt. */
export const DISPATCH_BRIEF_MAX = { steps: 24, acceptance: 16, constraints: 12, noteRefs: 32, line: 400 }

const line = (max = DISPATCH_BRIEF_MAX.line) => z.string().min(1).max(max)

export const dispatchBriefSchema = z.object({
  /** One sentence: what the terminal Agent must finish. */
  goal: line(),
  /** Ordered implementation steps. */
  steps: z.array(line()).max(DISPATCH_BRIEF_MAX.steps).default([]),
  /** How the work is judged done. */
  acceptance: z.array(line()).max(DISPATCH_BRIEF_MAX.acceptance).default([]),
  /** Boundaries the Agent must not cross. */
  constraints: z.array(line()).max(DISPATCH_BRIEF_MAX.constraints).default([]),
  /**
   * Note URIs this brief is grounded in. The host intersects these with the
   * Notes actually injected into the conversation, so a model cannot invent a
   * reference outside the authorized batch.
   */
  noteRefs: z.array(line()).max(DISPATCH_BRIEF_MAX.noteRefs).default([]),
})

export type DispatchBrief = z.infer<typeof dispatchBriefSchema>

export interface RenderDispatchBriefInput {
  brief: DispatchBrief
  blueprintName: string
  workspaceName: string
  workspacePath: string
  /** Repo-relative Note paths resolved from the authorized batch, in brief order. */
  notePaths: ReadonlyMap<string, string>
}

/**
 * Renders the brief as the exact text prefilled into the terminal. Never
 * submitted — the user reviews it in the pane and presses Enter themselves.
 */
export function renderDispatchBrief(input: RenderDispatchBriefInput): string {
  const { brief } = input
  const lines: string[] = [
    `# ${input.blueprintName} · 派发实施简报`,
    '',
    `工作区：${input.workspaceName}（${input.workspacePath}）`,
    '',
    '## 目标',
    brief.goal,
  ]
  if (brief.noteRefs.length) {
    lines.push('', '## 需求依据（Note 已在同一 checkout 内，直接按路径读取）')
    for (const uri of brief.noteRefs) {
      const path = input.notePaths.get(uri)
      lines.push(path ? `- ${path}（${uri}）` : `- ${uri}`)
    }
  }
  if (brief.steps.length) {
    lines.push('', '## 实施步骤')
    brief.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  }
  if (brief.acceptance.length) {
    lines.push('', '## 验收要点')
    for (const item of brief.acceptance) lines.push(`- ${item}`)
  }
  lines.push('', '## 约束')
  for (const item of brief.constraints) lines.push(`- ${item}`)
  lines.push('- 只改实现，不改 Note 正文；需求变更走 Janus 对话的提案审批。')
  return lines.join('\n')
}

/** Keep only URIs the host can prove were part of the authorized batch. */
export function authorizedNoteRefs(brief: DispatchBrief, authorized: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  return brief.noteRefs.filter((uri) => {
    if (!authorized.has(uri) || seen.has(uri)) return false
    seen.add(uri)
    return true
  })
}

/**
 * Node the dispatched terminal binds to, so closing the terminal still triggers
 * the existing terminal-close analysis on a real node. A node/subtree scope has
 * an obvious anchor; a whole-graph scope takes the first reachable Note.
 */
export function dispatchAnchorNodeId(
  blueprint: { nodes: Record<string, { sourceUri?: string | null }> },
  scope: BlueprintMaintenanceScope,
  allowed: ReadonlySet<string>,
  authorized: ReadonlySet<string>,
): string | null {
  const readable = (id: string | undefined): id is string =>
    !!id && allowed.has(id) && !!blueprint.nodes[id]?.sourceUri && authorized.has(blueprint.nodes[id].sourceUri!)
  if (scope.type !== 'blueprint' && readable(scope.nodeId)) return scope.nodeId
  for (const id of allowed) if (readable(id)) return id
  return null
}