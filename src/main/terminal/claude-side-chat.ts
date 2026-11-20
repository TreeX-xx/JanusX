import { randomUUID } from 'node:crypto'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConversationSnapshot } from '../../shared/conversation-display'
import { claudeTrustDirectory } from './claude-trust'
import { NativeSideTurnError, sideChatPolicy, type NativeSideSession } from './native-side-chat'
import { runSideChatProcess } from './side-chat-process'

async function lastCompletedMessage(path: string, before: number): Promise<string | undefined> {
  const transcript = await open(path, 'r').catch(error => {
    if (error.code === 'ENOENT') return
    throw error
  })
  if (!transcript) return
  try {
    const { size } = await transcript.stat()
    const start = Math.max(0, size - 16 * 1024 * 1024)
    const tail = Buffer.alloc(size - start)
    const { bytesRead } = await transcript.read(tail, 0, tail.length, start)
    const lines = tail.toString('utf8', 0, bytesRead).split('\n')
    if (start) lines.shift()
    for (const line of lines.reverse()) {
      let entry
      try { entry = JSON.parse(line) } catch { continue } // A writer can leave the last line incomplete.
      if (entry.type === 'assistant' && !entry.isSidechain && !entry.isApiErrorMessage && entry.message?.stop_reason === 'end_turn' &&
        typeof entry.uuid === 'string' && Date.parse(entry.timestamp) < before) return entry.uuid
    }
    if (start) throw new Error('Claude could not confirm the completed turn at the side-chat boundary.')
  } finally { await transcript.close() }
}

export async function openClaudeSideChat(
  options: { binary: string; cwd: string; env: NodeJS.ProcessEnv; configDir: string; settings: string },
  parent: ConversationSnapshot, signal: AbortSignal,
): Promise<NativeSideSession> {
  if (!parent.threadId || !/^[0-9a-f-]{36}$/i.test(parent.threadId)) throw new Error('Invalid Claude parent session.')
  const { binary, cwd, env, configDir, settings } = options
  const projects = join(configDir, 'projects')
  const name = parent.threadId + '.jsonl'
  const project = claudeTrustDirectory(cwd).replace(/[^a-z0-9-]/gi, '-')
  const before = parent.turnStartedAt ?? Date.now() + 1
  let boundary = await lastCompletedMessage(join(projects, project, name), before)
  if (!boundary) {
    const folders = await readdir(projects, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const folder of folders.slice(0, 1000)) {
      signal.throwIfAborted()
      if (folder.name === project || !folder.isDirectory()) continue
      boundary = await lastCompletedMessage(join(projects, folder.name, name), before)
      if (boundary) break
    }
  }
  signal.throwIfAborted()
  if (!boundary && parent.items?.some(item => item.type === 'agentMessage' && item.status === 'completed' && item.turnId !== parent.turnId))
    throw new Error('Claude could not confirm a completed turn in the native session history.')
  let childId: string | undefined
  return {
    async dispose() {},
    async ask(text, publish, turnSignal) {
      const id = childId ?? randomUUID()
      const resume = childId ? ['--resume', childId] : boundary
        ? ['--resume', parent.threadId!, '--resume-session-at', boundary, '--fork-session', '--session-id', id]
        : ['--session-id', id]
      let verified = false
      let complete = false
      let answer = ''
      await runSideChatProcess(binary, ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--include-partial-messages', '--tools', '', '--strict-mcp-config', '--disable-slash-commands',
        '--settings', settings, '--append-system-prompt', sideChatPolicy,
        ...(parent.model ? ['--model', parent.model] : []),
        ...(parent.effort && parent.effort !== 'default' ? ['--effort', parent.effort] : []), ...resume], cwd, env, turnSignal, frame => {
        if (frame.type === 'system' && frame.subtype === 'init') {
          if (frame.session_id !== id) throw new Error('Claude did not confirm an independent side session.')
          verified = true
        }
        if (!verified || frame.session_id !== id) return
        const delta = frame.event?.delta
        if (frame.type === 'stream_event' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
          answer = (answer + delta.text).slice(0, 64_000)
          publish(answer)
        }
        if (frame.type === 'result') {
          if (frame.is_error || frame.subtype !== 'success') throw new NativeSideTurnError((frame.errors ?? []).join('\n') || 'Claude side question failed.')
          if (typeof frame.result === 'string') answer = frame.result.slice(0, 64_000)
          complete = true
        }
      }, JSON.stringify({ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n')
      if (turnSignal.aborted) return answer
      if (!complete) throw new Error('Claude did not finish the side question.')
      childId = id
      return answer
    },
  }
}
