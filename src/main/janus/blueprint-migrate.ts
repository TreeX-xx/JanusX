// Note: on-demand JSON migration — see .agents/notes/blueprint/documents/history/blueprint-migration.md
/**
 * @file On-demand legacy JSON blueprint migration (S8-JanusX).
 * @description Converts one legacy JSON blueprint into harness Note drafts in
 *  the bound project checkout: nodes become requirements, tasks, decisions,
 *  or ideas by shape, relations re-anchor to the new identities, and a
 *  migration report keeps the legacy statuses plus audit history readable.
 *  Preview never writes; apply validates every note before a single
 *  transacted write, then archives (never deletes) the JSON source, which
 *  also marks the migration done. Everything created starts as a draft:
 *  machine migration asserts no acceptance.
 *  No Electron import, so unit tests drive real temp checkouts.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNote, serializeNote, validateNote } from '@janus-agent/harness-core'
import { noteAuthoringContext, maintainedNotePath, type NoteAuthoringContext } from '../../../plugins/blueprint/src/main/notes/note-authoring'
import type {
  Blueprint,
  BlueprintIssue,
  BlueprintNode,
} from '../../../plugins/blueprint/src/shared/janus/types'
import type { BlueprintMaintenanceAuditRecord } from '../../../plugins/blueprint/src/shared/janus/maintenance-types'
import { harnessNoteService } from '../harness/service'
import { blueprintsDir, blueprintFile, indexFile } from './blueprint-paths'
import { readJson, writeJson } from '../../../plugins/blueprint/src/main/janus/blueprint-persistence'

export type MigratedKind = 'note' | 'requirement' | 'task' | 'decision' | 'idea' | 'initiative'

export interface MigrationNodePlan {
  nodeId: string
  title: string
  kind: MigratedKind
  lifecycle: string
  noteId: string
  uri: string
}

export interface MigrationPreview {
  blueprintId: string
  name: string
  nodeCount: number
  auditCount: number
  appliedAuditCount: number
  notes: MigrationNodePlan[]
  relationCount: number
  warnings: string[]
  targetRepoId: string
}

export interface MigrationResult {
  txId: string
  uris: string[]
  reportUri: string
  archivedPath: string
}

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return slug || 'node'
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function section(name: string, body: string): string {
  return body.trim() ? `## ${name}\n${body.trim()}\n` : ''
}

function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

interface BuiltNote {
  plan: MigrationNodePlan
  markdown: string
  fileName: string
  parentNodeId: string | null
  governedByNodeId: string | null
}

function requirementFor(node: BlueprintNode, noteId: string): { markdown: string; fileName: string } {
  const features = node.features.map((feature) => `${feature.title} [${feature.status}]${feature.description ? ` — ${feature.description}` : ''}`)
  const openTodos = node.todos.filter((todo) => !todo.done).map((todo) => todo.text)
  const openIssues = node.issues.filter((issue) => issue.status === 'open').map((issue) => `${issue.title} (${issue.severity})`)
  const evidence = [
    ...node.analyses.slice(-1).map((analysis) => `Analysis ${analysis.id}: ${analysis.result.summary}`),
    ...node.activities.slice(-10).map((activity) => `[${activity.type}] ${activity.content}`),
  ]
  const open = [...openTodos, ...openIssues]
  if (node.status === 'done') open.push('Legacy status was done; re-acceptance required because completion without evidence never verifies.')
  if (node.status === 'blocked') open.push('Legacy status was blocked; re-triage before acceptance.')
  const markdown = [
    '---', 'schema: harness-note/1', `id: ${noteId}`, 'kind: requirement', 'lifecycle: draft', `created: ${today()}`, '---', '',
    `# ${node.title.replace(/\n/g, ' ')}`, '',
    section('Problem', node.description || node.title),
    section('Expected behavior', bullets(features)),
    section('Scope', node.positioning),
    section('Open questions', [bullets(open), node.notes ? `Legacy notes: ${node.notes}` : ''].filter(Boolean).join('\n')),
    section('Evidence', evidence.join('\n')),
  ].join('\n')
  return { markdown, fileName: `${today()}-migrated-${slugify(node.title)}--${noteId.slice(0, 8)}.md` }
}

function taskFor(node: BlueprintNode, issue: BlueprintIssue | null, noteId: string): { markdown: string; fileName: string } {
  const title = issue ? `${node.title} — ${issue.title}` : node.title
  const scope = issue ? `${issue.title}\n\n${issue.description}`.trim() : (node.description || node.title)
  const openTodos = node.todos.filter((todo) => !todo.done).map((todo) => todo.text)
  const markdown = [
    '---', 'schema: harness-note/1', `id: ${noteId}`, 'kind: task', 'lifecycle: draft',
    `created: ${today()}`, '---', '',
    `# ${title.replace(/\n/g, ' ')}`, '',
    section('Scope', scope),
    section('Open questions', issue ? `Severity: ${issue.severity}` : bullets(openTodos)),
    section('Evidence', issue ? '' : node.completedItems.map((item) => `Legacy completed checklist item: ${item}`).join('\n')),
  ].join('\n')
  return { markdown, fileName: `${today()}-migrated-${slugify(title)}--${noteId.slice(0, 8)}.md` }
}

function decisionFor(node: BlueprintNode, noteId: string): { markdown: string; fileName: string } {
  const markdown = [
    '---', 'schema: harness-note/1', `id: ${noteId}`, 'kind: decision', 'lifecycle: draft', `created: ${today()}`, '---', '',
    `# ${node.title.replace(/\n/g, ' ')} — technical choice`, '',
    section('Problem', node.description || node.title),
    section('Proposal', node.techSolution),
    section('Alternatives considered', 'Migrated without recorded alternatives.'),
  ].join('\n')
  return { markdown, fileName: `${today()}-migrated-${slugify(node.title)}--${noteId.slice(0, 8)}.md` }
}

/** Builds every note plus warnings without writing; shared by preview and apply. */
export function buildMigrationDocuments(blueprint: Blueprint, repoId: string): { built: BuiltNote[]; warnings: string[] } {  const built: BuiltNote[] = []
  const warnings: string[] = []
  const idOf = new Map<string, string>()
  const uriOf = (nodeId: string): string => `note://${repoId}/${idOf.get(nodeId) as string}`
  const nodes = blueprint.nodeIds
    .map((id) => blueprint.nodes[id])
    .filter((node): node is BlueprintNode => Boolean(node))
    .map((node) => {
      if (node.title.trim()) return node
      warnings.push(`Node ${node.id} has no title; it migrates as Untitled node.`)
      return { ...node, title: 'Untitled node' }
    })
  if (nodes.length !== blueprint.nodeIds.length) warnings.push('Some node ids have no node body; they were skipped with their relations.')

  const roots = nodes.filter((node) => !node.parentId || !blueprint.nodes[node.parentId])
  if (nodes.some((node) => node.parentId && !blueprint.nodes[node.parentId])) warnings.push('Some nodes reference missing parents; they migrate as roots.')
  const needInitiative = roots.length > 1
  let initiativeUri = ''
  if (needInitiative) {
    const initiativeId = randomUUID().toLowerCase()
    initiativeUri = `note://${repoId}/${initiativeId}`
    const markdown = [
      '---', 'schema: harness-note/1', `id: ${initiativeId}`, 'kind: initiative', 'lifecycle: draft', `created: ${today()}`, '---', '',
      `# Migrated: ${blueprint.name.replace(/\n/g, ' ')}`, '',
      section('Goal', blueprint.description || `Carry over the ${nodes.length} nodes of legacy blueprint ${blueprint.name}.`),
      section('Scope', `Migrated ${nodes.length} nodes with legacy statuses recorded for re-acceptance.`),
    ].join('\n')
    built.push({
      plan: { nodeId: '', title: `Migrated: ${blueprint.name}`, kind: 'initiative', lifecycle: 'draft', noteId: initiativeId, uri: initiativeUri },
      markdown, fileName: `${today()}-migrated-${slugify(blueprint.name)}--${initiativeId.slice(0, 8)}.md`,
      parentNodeId: null, governedByNodeId: null,
    })
  }

  for (const node of nodes) {
    const noteId = randomUUID().toLowerCase()
    idOf.set(node.id, noteId)
  }
  for (const node of nodes) {
    const noteId = idOf.get(node.id) as string
    const uri = uriOf(node.id)
    const parentNodeId = node.parentId && blueprint.nodes[node.parentId] ? node.parentId : null
    if (node.type === 'epic' || node.type === 'feature') {
      const { markdown, fileName } = requirementFor(node, noteId)
      built.push({ plan: { nodeId: node.id, title: node.title, kind: 'requirement', lifecycle: 'draft', noteId, uri }, markdown, fileName, parentNodeId, governedByNodeId: node.techSolution.trim() ? node.id : null })
      if (node.techSolution.trim()) {
        const decisionId = randomUUID().toLowerCase()
        const decision = decisionFor(node, decisionId)
        built.push({ plan: { nodeId: node.id, title: `${node.title} (choice)`, kind: 'decision', lifecycle: 'draft', noteId: decisionId, uri: `note://${repoId}/${decisionId}` }, ...decision, parentNodeId, governedByNodeId: null })
      }
    } else if (node.type === 'task') {
      const { markdown, fileName } = taskFor(node, null, noteId)
      built.push({ plan: { nodeId: node.id, title: node.title, kind: 'task', lifecycle: 'draft', noteId, uri }, markdown, fileName, parentNodeId, governedByNodeId: node.techSolution.trim() ? node.id : null })
      if (node.techSolution.trim()) {
        const decisionId = randomUUID().toLowerCase()
        const decision = decisionFor(node, decisionId)
        built.push({ plan: { nodeId: node.id, title: `${node.title} (choice)`, kind: 'decision', lifecycle: 'draft', noteId: decisionId, uri: `note://${repoId}/${decisionId}` }, ...decision, parentNodeId, governedByNodeId: null })
      }
    } else {
      const open = node.issues.filter((issue) => issue.status === 'open')
      const closed = node.issues.filter((issue) => issue.status !== 'open')
      // Resolved issues fold into evidence: archived tasks would need a
      // fabricated execution contract, which is worse than readable history.
      const resolvedLines = closed.map((issue) => `Resolved before migration [${issue.status}]: ${issue.title}${issue.description ? ` — ${issue.description}` : ''}`)
      if (open.length === 0 && closed.length === 0) {
        const { markdown, fileName } = taskFor(node, null, noteId)
        built.push({ plan: { nodeId: node.id, title: node.title, kind: 'task', lifecycle: 'draft', noteId, uri }, markdown, fileName, parentNodeId, governedByNodeId: null })
      }
      for (const [index, issue] of open.entries()) {
        // Relations to the legacy issue node resolve to its first open issue.
        const issueId = index === 0 ? noteId : randomUUID().toLowerCase()
        const base = taskFor(node, issue, issueId)
        const markdown = resolvedLines.length > 0
          ? base.markdown.replace('## Evidence', `## Evidence\n${resolvedLines.join('\n')}`)
          : base.markdown
        built.push({ plan: { nodeId: node.id, title: `${node.title} — ${issue.title}`, kind: 'task', lifecycle: 'draft', noteId: issueId, uri: `note://${repoId}/${issueId}` }, markdown, fileName: base.fileName, parentNodeId, governedByNodeId: null })
      }
      if (open.length === 0 && closed.length > 0) {
        const { markdown: bare, fileName } = taskFor(node, null, noteId)
        const markdown = bare.replace('## Evidence', `## Evidence\n${resolvedLines.join('\n')}`)
        built.push({ plan: { nodeId: node.id, title: node.title, kind: 'task', lifecycle: 'draft', noteId, uri }, markdown, fileName, parentNodeId, governedByNodeId: null })
      }
      if (closed.length > 0) warnings.push(`Node ${node.title} keeps ${closed.length} resolved issues as evidence, not tasks.`)
    }
    const legacyDone = node.status === 'done' && (node.type === 'epic' || node.type === 'feature' || node.type === 'task')
    if (legacyDone) warnings.push(`Node ${node.title} was done in legacy data and migrates as a draft for re-acceptance.`)
  }

  // Pending requirement candidates become ideas; decided ones stay in the report.
  const pending = blueprint.requirementCandidates.filter((candidate) => candidate.status === 'pending')
  for (const candidate of pending) {
    const ideaId = randomUUID().toLowerCase()
    const markdown = [
      '---', 'schema: harness-note/1', `id: ${ideaId}`, 'kind: idea', 'lifecycle: draft', `created: ${today()}`,
      ...(candidate.sourceNodeId && idOf.has(candidate.sourceNodeId) ? [`parent: ${uriOf(candidate.sourceNodeId)}`] : []),
      '---', '',
      `# ${candidate.title.replace(/\n/g, ' ')}`, '',
      section('Background', candidate.description || candidate.title),
      section('Idea', `Carry over pending candidate ${candidate.id} (confidence ${candidate.confidence}).`),
    ].join('\n')
    built.push({ plan: { nodeId: candidate.sourceNodeId, title: candidate.title, kind: 'idea', lifecycle: 'draft', noteId: ideaId, uri: `note://${repoId}/${ideaId}` }, markdown, fileName: `${today()}-migrated-${slugify(candidate.title)}--${ideaId.slice(0, 8)}.md`, parentNodeId: null, governedByNodeId: null })
  }
  const decided = blueprint.requirementCandidates.length - pending.length
  if (decided > 0) warnings.push(`${decided} decided requirement candidates stay in the report; their outcomes already landed as nodes.`)

  // Second pass: parents, governed-by, and mapped relations with fresh identities.
  const withRelations = built.map((item) => {
    const lines = item.markdown.split('\n')
    // findIndex takes thisArg, not fromIndex: match the closing fence by index.
    const insertAt = lines.findIndex((line, index) => index > 0 && line === '---')
    if (insertAt < 0) throw { code: 'SCHEMA_INVALID', message: `migrated note lost its frontmatter for ${item.plan.title}` }
    const extra: string[] = []
    const parentUri = item.parentNodeId && idOf.has(item.parentNodeId) && item.parentNodeId !== item.plan.nodeId
      ? uriOf(item.parentNodeId)
      : (!item.parentNodeId && needInitiative && item.plan.kind !== 'initiative' ? initiativeUri : null)
    // Root nodes without parents aggregate under the initiative; issue/task
    // children keep their node parent; ideas already carry parents.
    if (item.plan.kind === 'idea' && item.markdown.includes('\nparent: ')) {
      // already parented above
    } else if (parentUri) {
      extra.push(`parent: ${parentUri}`)
    }
    const relations: string[] = []
    if (item.governedByNodeId) {
      const decision = built.find((other) => other.plan.nodeId === item.governedByNodeId && other.plan.kind === 'decision')
      if (decision) relations.push(`  - type: governed-by\n    target: ${decision.plan.uri}`)
    }
    if (item.plan.nodeId) {
      for (const relation of blueprint.relations) {
        if (!idOf.has(relation.sourceNodeId) || !idOf.has(relation.targetNodeId)) continue
        const sourceUri = uriOf(relation.sourceNodeId)
        const targetUri = uriOf(relation.targetNodeId)
        if (item.plan.uri !== sourceUri && item.plan.uri !== targetUri) continue
        const kindOf = (nodeId: string): string | undefined =>
          built.find((other) => other.plan.nodeId === nodeId && other.plan.kind !== 'decision')?.plan.kind
        const sourceKind = kindOf(relation.sourceNodeId)
        const targetKind = kindOf(relation.targetNodeId)
        const directed = !!sourceKind && !!targetKind && ['requirement', 'task'].includes(sourceKind) && ['requirement', 'task'].includes(targetKind)
        const smaller = (a: string, b: string): boolean => a.localeCompare(b) < 0
        if (item.plan.uri === sourceUri) {
          if (relation.type === 'depends-on' && directed) {
            relations.push(`  - type: depends-on\n    target: ${targetUri}`)
          } else if (relation.type === 'implements' && sourceKind === 'task' && targetKind === 'requirement') {
            relations.push(`  - type: implements\n    target: ${targetUri}`)
          } else if (relation.type === 'related-to' && smaller(sourceUri, targetUri)) {
            relations.push(`  - type: related-to\n    target: ${targetUri}`)
          } else if (relation.type !== 'related-to' && smaller(sourceUri, targetUri)) {
            relations.push(`  - type: related-to\n    target: ${targetUri}`)
          }
        } else if (item.plan.uri === targetUri) {
          if (relation.type === 'blocks' && directed) {
            relations.push(`  - type: depends-on\n    target: ${sourceUri}`)
          } else if (relation.type === 'related-to' && smaller(targetUri, sourceUri)) {
            relations.push(`  - type: related-to\n    target: ${sourceUri}`)
          } else if (relation.type === 'blocks' && smaller(targetUri, sourceUri)) {
            relations.push(`  - type: related-to\n    target: ${sourceUri}`)
          }
        }
      }
    }
    if (extra.length > 0 || relations.length > 0) {
      lines.splice(insertAt, 0, ...extra, ...(relations.length > 0 ? ['relations:', ...relations] : []))
    }
    return { ...item, markdown: lines.join('\n') }
  })
  return { built: withRelations, warnings }
}

function reportFor(blueprint: Blueprint, plans: MigrationNodePlan[], audits: BlueprintMaintenanceAuditRecord[], warnings: string[], reportId: string): { markdown: string; fileName: string; uri: string } {
  const rows = plans.map((plan) => `- ${plan.kind}/${plan.lifecycle}: ${plan.title} (${plan.uri})`).join('\n')
  const auditRows = audits.map((audit) => `- ${audit.id}: ${audit.status}, changeset ${audit.changeSetId}, task ${audit.taskId}${audit.appliedAt ? `, applied ${audit.appliedAt}` : ''}`).join('\n')
  const markdown = [
    '---', 'schema: harness-note/1', `id: ${reportId}`, 'kind: idea', 'lifecycle: draft', `created: ${today()}`, '---', '',
    `# Migration report: ${blueprint.name.replace(/\n/g, ' ')}`, '',
    section('Background', `Migrated legacy JSON blueprint ${blueprint.id} with ${plans.length} notes. Legacy statuses never imply verification: done nodes migrate as drafts for re-acceptance. Applied audits stay readable below; raw audit files remain in local app data.`),
    section('Idea', [rows, '## Audits', auditRows || '(no audits)', warnings.length > 0 ? `## Skipped content\n${bullets(warnings)}` : ''].filter(Boolean).join('\n')),
  ].join('\n')
  return { markdown, fileName: `${today()}-migrated-report--${reportId.slice(0, 8)}.md`, uri: '' }
}

function adaptImportedMarkdown(markdown: string, context: NoteAuthoringContext): string {
  const note = parseNote(markdown), originalKind = note.meta.kind
  note.meta.schema = 'harness-note/2'
  note.meta.module = context.module
  note.meta.updated = new Date().toISOString()
  note.meta.extensions = { ...note.meta.extensions, legacyBlueprint: { kind: originalKind } }
  // Legacy feature descriptions have no fixed acceptance criteria either.
  if (['task', 'initiative', 'requirement'].includes(originalKind)) note.meta.kind = 'note'
  if (originalKind === 'decision') {
    note.body = note.body.replace(/^## Proposal$/m, '## Decision').replace(/^## Risks$/m, '## Consequences')
    if (!/^## Consequences$/m.test(note.body)) note.body += '\n## Consequences\n\nThe legacy source did not record consequences; assess before accepting this choice.\n'
  }
  if (originalKind === 'idea') note.body = note.body.replace(/^## Background$/m, '## Intent').replace(/^## Idea$/m, '## Description')
  // Legacy checklist/dependency arrows are historical associations, never a fabricated Task contract.
  note.meta.relations = note.meta.relations?.map(relation => ['implements', 'depends-on'].includes(relation.type) ? { type: 'related-to', target: relation.target } : relation)
  return serializeNote(note)
}

function adaptImportedDocuments(built: ReturnType<typeof buildMigrationDocuments>['built'], context: NoteAuthoringContext | undefined, warnings: string[]) {
  if (context?.schema !== 'harness-note/2') return
  const paths = new Set<string>()
  for (const item of built) {
    item.markdown = adaptImportedMarkdown(item.markdown, context)
    item.plan.kind = parseNote(item.markdown).meta.kind as MigratedKind
    const base = maintainedNotePath(context.directory!, item.plan.title)
    item.fileName = base
    for (let suffix = 2; paths.has(item.fileName.toLowerCase()); suffix++) item.fileName = base.replace(/\.md$/, `-${suffix}.md`)
    paths.add(item.fileName.toLowerCase())
  }
  warnings.push('Legacy task checklists are imported as ordinary Notes. Main Agent must author an explicit Task contract before execution.')
}

/** Builds the migration preview without writing anything. */
export function previewMigration(blueprint: Blueprint, repoId: string, audits: BlueprintMaintenanceAuditRecord[], authoring?: NoteAuthoringContext): MigrationPreview {
  if (blueprint.source === 'harness') throw { code: 'SCHEMA_INVALID', message: 'harness blueprints need no migration' }
  const { built, warnings } = buildMigrationDocuments(blueprint, repoId)
  adaptImportedDocuments(built, authoring, warnings)
  const relationCount = built.reduce((count, item) => count + (parseNote(item.markdown).meta.relations?.length ?? 0), 0)
  return {
    blueprintId: blueprint.id,
    name: blueprint.name,
    nodeCount: blueprint.nodeIds.length,
    auditCount: audits.length,
    appliedAuditCount: audits.filter((audit) => audit.status === 'applied').length,
    notes: built.map((item) => item.plan),
    relationCount,
    warnings,
    targetRepoId: repoId,
  }
}

/**
 * Applies one migration transacted: validates every note first, writes once,
 * then archives the JSON source. The archived source is the idempotence
 * marker: a second run refuses with NOT_FOUND instead of duplicating notes.
 */
export async function applyMigration(
  root: string,
  repoId: string,
  blueprint: Blueprint,
  audits: BlueprintMaintenanceAuditRecord[],
  archive: (blueprintId: string) => Promise<string>,
): Promise<MigrationResult> {
  if (blueprint.source === 'harness') throw { code: 'SCHEMA_INVALID', message: 'harness blueprints need no migration' }
  const { built, warnings } = buildMigrationDocuments(blueprint, repoId)
  const authoring = await noteAuthoringContext(harnessNoteService, root, undefined, repoId)
  adaptImportedDocuments(built, authoring, warnings)
  const reportId = randomUUID().toLowerCase()
  const report = reportFor(blueprint, built.map((item) => item.plan), audits, warnings, reportId)
  report.uri = `note://${repoId}/${reportId}`
  if (authoring.schema === 'harness-note/2') {
    report.markdown = adaptImportedMarkdown(report.markdown, authoring)
    const base = maintainedNotePath(authoring.directory!, `Migration ${blueprint.name} report`)
    report.fileName = base
    for (let suffix = 2; built.some(item => item.fileName.toLowerCase() === report.fileName.toLowerCase()); suffix++) report.fileName = base.replace(/\.md$/, `-${suffix}.md`)
  }
  const documents = [...built.map((item) => ({ markdown: item.markdown, fileName: item.fileName })), { markdown: report.markdown, fileName: report.fileName }]
  for (const document of documents) {
    let parsed: ReturnType<typeof parseNote>
    try {
      parsed = parseNote(document.markdown)
    } catch (error) {
      throw { code: 'SCHEMA_INVALID', message: `migrated note fails to parse (${document.fileName}): ${(error as Error).message} :: head: ${JSON.stringify(document.markdown.slice(0, 120))}` }
    }
    const problems = validateNote(parsed)
    if (problems.length > 0) throw { code: problems[0]?.code ?? 'SCHEMA_INVALID', message: `migrated note invalid (${document.fileName}): ${problems[0]?.message ?? 'unknown'}`, path: problems[0]?.path }
  }
  const applied = await harnessNoteService.applyOperations(root, documents.map((document) => ({
    operationId: randomUUID(),
    type: 'create' as const,
    uri: `note://${repoId}/${(parseNote(document.markdown).meta as { id: string }).id}`,
    expectedHash: null,
    relativePath: document.fileName,
    afterMarkdown: document.markdown,
  })), `Migrate legacy blueprint ${blueprint.name}`)
  const archivedPath = await archive(blueprint.id)
  return { txId: applied.txId, uris: [...built.map((item) => item.plan.uri), report.uri], reportUri: report.uri, archivedPath }
}

/**
 * Archives the JSON source after a successful write: detaches it from the
 * index tolerantly, then moves the file under archived/. The move is the
 * idempotence marker and never deletes content. Callers refresh blueprint
 * lists afterwards; the in-memory store cache drops the id on next list.
 */
export async function archiveBlueprintSource(blueprintId: string): Promise<string> {
  try {
    const index = await readJson<{ blueprints?: string[] }>(indexFile())
    if (index && Array.isArray(index.blueprints)) {
      await writeJson(indexFile(), { ...index, blueprints: index.blueprints.filter((id) => id !== blueprintId) })
    }
  } catch {
    // Index loss never blocks the archive; the moved file is the truth.
  }
  const archivedDir = join(blueprintsDir(), 'archived')
  await mkdir(archivedDir, { recursive: true })
  const archivedPath = join(archivedDir, `${blueprintId}.json`)
  try {
    await rename(blueprintFile(blueprintId), archivedPath)
  } catch (error) {
    throw { code: 'IO_ERROR', message: `cannot archive blueprint ${blueprintId}: ${(error as Error).message}` }
  }
  return archivedPath
}
