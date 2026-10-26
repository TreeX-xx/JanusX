// Note: .agents/notes/sessions/workspace-runtime-import.md
// Bundled without Electron; this process runs on the Linux workspace host.
import { createInterface } from 'node:readline'
import { realpath, stat } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { registerHarnessDocumentHandlers, type DocumentHandler } from '../harness/document-handlers'
import { harnessNoteService } from '../harness/service'
import { blueprintNoteView } from '../blueprint/note-service'
import { scanExternalSessions, type ExternalSessionSink } from '../sessions/external-session-scanner'
import type { ImportExternalSessionInput } from '../sessions/session-registry'
import { readTranscriptDetail } from '../sessions/transcript-reader'
import { buildProviderResumeArgs } from '../../shared/ipc/session'

console.log = console.debug = console.info = (...args) => console.error(...args)
const handlers = new Map<string, DocumentHandler>()
registerHarnessDocumentHandlers((channel, handler) => handlers.set(channel, handler), false)
const sessions = new Map<string, ImportExternalSessionInput>()
const collector: ExternalSessionSink = {
  listSessions: () => [...sessions.values()], beginBatch() {}, endBatch() {},
  importExternalSession(input: ImportExternalSessionInput) { sessions.set(`${input.engine}:${input.providerSessionId}`, input); return input },
}

async function scopedSession(root: string, key: string) {
  sessions.clear()
  await scanExternalSessions(collector)
  const record = sessions.get(key)
  if (!record) throw new Error('Remote provider history is no longer available')
  const cwd = await realpath(record.cwd)
  const rel = relative(await realpath(root), cwd)
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Session belongs to another workspace directory')
  return record
}

async function dispatch(data: { method: string; root: string; owner: number; args: any[] }) {
  if (data.method === 'session.scan') {
    sessions.clear()
    await scanExternalSessions(collector)
    const root = await realpath(data.root)
    return [...sessions.values()].filter(record => {
      const rel = relative(root, record.cwd)
      return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
    })
  }
  if (data.method === 'session.transcript' || data.method === 'session.resume') {
    const record = await scopedSession(data.root, data.args[0])
    if (data.method === 'session.transcript') return readTranscriptDetail(record.transcriptPath, record.engine, record.providerSessionId)
    const args = buildProviderResumeArgs(record.engine, record.providerSessionId, record.transcriptPath)
    if (!args || !['claude', 'codex', 'opencode', 'pi'].includes(record.engine)) throw new Error('This provider does not support native resume')
    const detail = await readTranscriptDetail(record.transcriptPath, record.engine, record.providerSessionId)
    if (!detail) throw new Error('Cannot read the original provider history; no process was started')
    if (!(await stat(record.cwd)).isDirectory()) throw new Error('Original session directory is unavailable')
    // The desktop's remote terminal adapter validates/resolves the CLI using the
    // same Linux environment as installation, including JanusX's user prefix.
    return { args, cwd: record.cwd, engine: record.engine, command: record.engine }
  }
  if (data.method === 'blueprint.ui.save') return blueprintNoteView.saveUiState(data.root, data.args[0])
  const handler = handlers.get(data.method)
  if (!handler) throw new Error('CAPABILITY_UNAVAILABLE: This operation is not available on remote workspaces yet')
  if (data.method === 'harness:index:rev') await harnessNoteService.rescan(data.root)
  return handler({ sender: { id: data.owner, once() {} } }, data.root, ...data.args)
}

// Serialize mutations and preview ownership within one long-lived backend.
let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', line => {
  queue = queue.then(async () => {
    let id: unknown
    try {
      const data = JSON.parse(line); id = data.id
      const result = await dispatch(data)
      process.stdout.write(JSON.stringify({ id, result: result ?? null }) + '\n')
    } catch (error) {
      const failure = error as { code?: string; message?: string }
      process.stdout.write(JSON.stringify({ id, error: { ...failure, message: failure?.message ?? String(error) } }) + '\n')
    }
  })
})
