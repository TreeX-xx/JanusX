import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ConversationModelOption } from '../../shared/conversation-display'

export function claudeModelOptions(rows: unknown): ConversationModelOption[] {
  if (!Array.isArray(rows)) throw new Error('Claude returned no model catalog')
  const models = new Map<string, ConversationModelOption>()
  for (const row of rows.slice(0, 200)) {
    if (!row || row.disabled || typeof row.resolvedModel !== 'string' || !row.resolvedModel || row.resolvedModel.length > 200) continue
    const efforts: string[] = row.supportsEffort && Array.isArray(row.supportedEffortLevels)
      ? row.supportedEffortLevels.filter((value: unknown) => typeof value === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) : []
    const model = row.resolvedModel
    // Alias rows carry the native account/provider capabilities; do not invent
    // newer models or copy Codex's effort levels into this catalog.
    models.set(model, { model, displayName: String(row.displayName || model).slice(0, 200), description: String(row.description || '').slice(0, 2000),
      defaultEffort: null, efforts: [...new Set(efforts)].map(effort => ({ effort, description: '' })) })
  }
  if (!models.size) throw new Error('Claude returned no selectable models')
  return [...models.values()]
}

/** Read-only native initialization, no user prompt/model call or saved session. */
export function readClaudeModels(options: { binary: string; cwd: string; env: NodeJS.ProcessEnv; settings: string; signal: AbortSignal }): Promise<ConversationModelOption[]> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) { reject(new Error('Claude session closed')); return }
    const id = randomUUID()
    let result: ConversationModelOption[] | undefined
    let failure: Error | undefined
    let buffer = '', size = 0
    const child = spawn(options.binary, ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--settings', options.settings],
    { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const abort = () => { failure = new Error('Claude model catalog cancelled'); child.kill() }
    const timer = setTimeout(() => { failure = new Error('Claude model catalog timed out'); child.kill() }, 15000)
    options.signal.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort) }
    child.on('error', error => { cleanup(); reject(error) })
    child.on('close', () => { cleanup(); if (result && !failure) resolve(result); else reject(failure ?? new Error('Claude model catalog closed without a response')) })
    child.stderr?.resume()
    child.stdin?.on('error', () => {})
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (data: string) => {
      if (result || failure) return
      size += data.length
      if (size > 2_000_000) { failure = new Error('Claude model catalog exceeded its limit'); child.kill(); return }
      buffer += data
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(line)
          if (message.type !== 'control_response' || message.response?.request_id !== id) continue
          if (message.response.subtype !== 'success') throw new Error('Claude refused model discovery')
          result = claudeModelOptions(message.response.response?.models)
        } catch (error) { failure = error instanceof Error ? error : new Error(String(error)) }
        if (result || failure) { child.stdin?.end(); child.kill(); break }
      }
    })
    child.stdin?.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'initialize' } }) + '\n')
  })
}
