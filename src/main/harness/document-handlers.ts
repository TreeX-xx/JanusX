// Note: .agents/notes/sessions/workspace-runtime-import.md
// Shared desktop/Linux document operations; transactions run beside the source.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ParsedNote } from '@janus-agent/harness-core'
import { readMarkdownView } from '@janus-agent/harness-core'
import { archiveNoteOp } from '@janus-agent/harness-core'
import { requireBlueprintPlugin } from '../plugins/legacy-blueprint'
import { toNoteDoc } from '../notes/note-provider'
import { harnessNoteService } from './service'
import { workspaceNotesService } from './workspace-notes'
import type { IncomingSnapshot } from './share-import'
import { adoptTask, readTaskDraft } from './task-adoption'
import { applyUndo, previewUndo } from './undo'
import { HARNESS_COMMAND_CHANNELS, type HarnessFailure, type HarnessApplyResult, type HarnessResolveResult, type HarnessBinding, type HarnessEditOp, type HarnessShareSelection, type HarnessTaskContractInput, type HarnessUndoPreview, type HarnessUndoResult } from '../../shared/ipc/harness'
export type DocumentEvent = { sender: { id: number; once(event: string, listener: () => void): unknown } }
export type DocumentHandler = (event: DocumentEvent, cwd: string, ...args: any[]) => any
export type RegisterDocumentHandler = (channel: string, handler: DocumentHandler) => void
const throwFailure = (code: HarnessFailure['code'], message: string, extra?: Partial<HarnessFailure>): never => { throw { code, message, ...extra } }
const throwRunFailure = (errors: Array<{code: string; message: string}>): never => { throw errors[0] ?? {code: 'IO_ERROR', message: 'Operation failed'} }
async function withRoot(cwd: string): Promise<string> {
  const resolved = await harnessNoteService.resolveRoot(cwd)
  if (!resolved.ok || !resolved.root) {
    throwFailure('NOT_FOUND', resolved.diagnostics[0]?.message ?? `no project notes under ${cwd}`)
  }
  return resolved.root as string
}

interface CurrentNote {
  note: ParsedNote
  relPath: string
  sha256: string
}

async function currentNote(root: string, uri: string): Promise<CurrentNote> {
  return harnessNoteService.readNote(root, uri)
}

export function registerHarnessDocumentHandlers(handle: RegisterDocumentHandler): void {
  const previewOwners = new Set<number>()
  handle(HARNESS_COMMAND_CHANNELS.workspaceStatus, (_e, cwd: string) => workspaceNotesService.status(cwd))
  handle(HARNESS_COMMAND_CHANNELS.initPreview, (event, cwd: string, name: string) => {
    const owner = event.sender.id
    if (!previewOwners.has(owner)) {
      previewOwners.add(owner)
      event.sender.once('destroyed', () => { previewOwners.delete(owner); workspaceNotesService.release(owner) })
    }
    return workspaceNotesService.preview(cwd, name, owner)
  })
  handle(HARNESS_COMMAND_CHANNELS.initApply, (event, cwd: string, id: string, foreign: boolean) => workspaceNotesService.apply(cwd, id, event.sender.id, foreign))
  handle(HARNESS_COMMAND_CHANNELS.initUndo, (event, cwd: string, id: string) => workspaceNotesService.undo(cwd, id, event.sender.id))
  // Note: wiki and blueprint resolve the same source — see .agents/notes/blueprint/documents/tasks/note-wiki-r3.md
  handle(HARNESS_COMMAND_CHANNELS.noteRead, async (_e, cwd: string, uri: string) => {
    if (typeof uri !== 'string' || !uri.startsWith('note://')) throw new Error('A complete Note URI is required')
    const source = await harnessNoteService.readNote(await withRoot(cwd), uri)
    return { uri, relPath: source.relPath, raw: source.raw, sourceHash: source.sha256,
      indexedSourceHash: source.indexedSourceHash, matchesSnapshot: source.matchesSnapshot,
      doc: toNoteDoc(source.note), view: readMarkdownView(source.note.body) }
  })
  handle(HARNESS_COMMAND_CHANNELS.taskRead, async (_e, cwd: string, uri: string) => readTaskDraft(await withRoot(cwd), uri))
  handle(HARNESS_COMMAND_CHANNELS.taskAdopt, async (_e, cwd: string, uri: string, expectedHash: string, contract: HarnessTaskContractInput) => adoptTask(await withRoot(cwd), uri, expectedHash, contract))

  handle(HARNESS_COMMAND_CHANNELS.resolve, async (_e, cwd: string): Promise<HarnessResolveResult> => {
    const resolved = await harnessNoteService.resolveRoot(cwd)
    if (!resolved.ok || !resolved.root) return { ok: false, diagnostics: resolved.diagnostics }
    const { index } = await harnessNoteService.readIndex(resolved.root)
    return { ok: true, root: resolved.root, repoId: index.repoId, repoName: await harnessNoteService.repoName(resolved.root), diagnostics: [] }
  })

  handle(HARNESS_COMMAND_CHANNELS.projectGraph, async () => requireBlueprintPlugin())

  handle(HARNESS_COMMAND_CHANNELS.rescan, async (_e, cwd: string) => {
    const root = await withRoot(cwd)
    return harnessNoteService.rescan(root)
  })

  handle(HARNESS_COMMAND_CHANNELS.getRev, async (_e, cwd: string) => {
    const root = await withRoot(cwd)
    return harnessNoteService.getRev(root)
  })

  handle(HARNESS_COMMAND_CHANNELS.warmup, async (_e, cwd: string) => {
    const root = await withRoot(cwd)
    return harnessNoteService.warmup(root)
  })

  handle(HARNESS_COMMAND_CHANNELS.noteSnapshot, async (_e, cwd: string) => {
    const root = await withRoot(cwd)
    return harnessNoteService.readSnapshot(root)
  })

  handle(
    HARNESS_COMMAND_CHANNELS.apply,
    async (_e, cwd: string, operations: HarnessEditOp[], reason: string): Promise<HarnessApplyResult> => {
      const root = await withRoot(cwd)
      const { index: view } = await harnessNoteService.readIndex(root)
      if (!view.repoId) throwFailure('NOT_FOUND', 'init .agents/harness.json with a repoId first')
      const ops: Array<{
        operationId: string
        type: 'create' | 'replace' | 'delete'
        uri: string
        expectedHash: string | null
        relativePath?: string
        afterMarkdown?: string
      }> = []
      const uris: string[] = []
      for (const op of operations) {
        if (op.kind === 'create' || op.kind === 'update') {
          // Legacy canvas fields belong to native plugin transactions.
          requireBlueprintPlugin()
        } else if (op.kind === 'rename') {
          const current = await currentNote(root, op.uri)
          const raw = await readFile(join(root, current.relPath), 'utf8')
          ops.push({
            operationId: `rename-${current.note.meta.id.slice(0, 8)}`,
            type: 'replace',
            uri: op.uri,
            expectedHash: op.expectedHash,
            relativePath: op.relativePath,
            afterMarkdown: raw,
          })
          uris.push(op.uri)
        } else if (op.kind === 'reparent') {
          const current = await currentNote(root, op.uri)
          const raw = await readFile(join(root, current.relPath), 'utf8')
          const markdown = harnessNoteService.mergeNoteEdit(
            current.note,
            raw,
            { sections: {}, frontmatter: { parent: op.parentUri } },
            reason,
          )
          ops.push({
            operationId: `reparent-${current.note.meta.id.slice(0, 8)}`,
            type: 'replace',
            uri: op.uri,
            expectedHash: op.expectedHash,
            afterMarkdown: markdown,
          })
          uris.push(op.uri)
        } else {
          const current = await currentNote(root, op.uri)
          const raw = await readFile(join(root, current.relPath), 'utf8')
          const markdown = harnessNoteService.mergeNoteEdit(
            current.note,
            raw,
            { sections: {}, frontmatter: { lifecycle: 'archived' } },
            op.reason,
          )
          const archived = archiveNoteOp(op.uri, op.expectedHash, markdown, op.reason)
          ops.push({ ...archived })
          uris.push(op.uri)
        }
      }
      try {
        const report = await harnessNoteService.applyOperations(root, ops, reason || 'canvas edit')
        return {
          txId: report.txId,
          applied: report.applied.map((r, i) => ({ ...r, uri: uris[i] ?? '' })),
        }
      } catch (e) {
        const err = e as Partial<HarnessFailure> & { message?: unknown }
        if (err.code === 'HARNESS_CONFLICT' || err.code === 'CONFLICT') {
          throw {
            code: 'HARNESS_CONFLICT',
            message: String(err.message ?? 'conflict'),
            path: err.path,
            expectedHash: err.expectedHash,
            currentHash: err.currentHash,
          } as HarnessFailure
        }
        throw { code: err.code ?? 'SCHEMA_INVALID', message: String(err.message ?? e) } as HarnessFailure
      }
    },
  )

  handle(HARNESS_COMMAND_CHANNELS.bindingsGet, async (_e, cwd: string) => {
    const root = await withRoot(cwd)
    return harnessNoteService.getBindings(root)
  })

  handle(HARNESS_COMMAND_CHANNELS.bindingsSet, async (_e, cwd: string, binding: HarnessBinding) => {
    const root = await withRoot(cwd)
    return harnessNoteService.setBinding(root, binding)
  })

  handle(HARNESS_COMMAND_CHANNELS.sharePreview, async (_e, cwd: string, selection: HarnessShareSelection) => {
    const root = await withRoot(cwd)
    const snapshot = await harnessNoteService.shareSnapshot(root, selection)
    return { notes: snapshot.notes.length, json: JSON.stringify(snapshot, null, 2) }
  })

  handle(
    HARNESS_COMMAND_CHANNELS.shareExport,
    async (_e, cwd: string, selection: HarnessShareSelection, outPath: string) => {
      const root = await withRoot(cwd)
      return harnessNoteService.exportSnapshot(root, selection, outPath)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.shareImportPreview,
    async (_e, cwd: string, snapshot: IncomingSnapshot) => {
      const root = await withRoot(cwd)
      const plan = await harnessNoteService.previewShareImport(root, snapshot)
      return {
        notes: plan.notes.map((item) => ({ id: item.id, action: item.kind, ...('reason' in item && item.reason ? { reason: item.reason } : {}) })),
        receipts: plan.receipts.map((item) => ({ id: item.id, action: item.action, ...(item.reason ? { reason: item.reason } : {}) })),
      }
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.shareImportApply,
    async (_e, cwd: string, snapshot: IncomingSnapshot) => {
      const root = await withRoot(cwd)
      return harnessNoteService.applyShareImport(root, snapshot)
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.undoPreview,
    async (_e, cwd: string, txId?: string): Promise<HarnessUndoPreview> => {
      const root = await withRoot(cwd)
      const previewed = await previewUndo(root, txId)
      if (!previewed.preview) throwRunFailure(previewed.errors)
      return previewed.preview!
    },
  )

  handle(
    HARNESS_COMMAND_CHANNELS.undoApply,
    async (_e, cwd: string, txId?: string): Promise<HarnessUndoResult> => {
      const root = await withRoot(cwd)
      const applied = await applyUndo(root, txId)
      if (applied.errors.length > 0) throwRunFailure(applied.errors)
      return { txId: applied.txId, reverted: applied.reverted }
    },
  )

}
