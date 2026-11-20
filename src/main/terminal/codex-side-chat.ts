import type { ConversationSnapshot } from '../../shared/conversation-display'
import { codexLoopbackEnv, resolveCodexServerBinary } from './codex-conversation'
import { CodexManagedTransport, type CodexRpc } from './codex-managed-transport'
import type { NativeLaunch } from './native-conversation'
import { NativeSideTurnError, sideChatPolicy, type NativeSideSession } from './native-side-chat'

// Each side thread owns its app-server connection. The TUI connection can switch threads independently.
export async function openCodexSideChat(launch: NativeLaunch, parent: ConversationSnapshot, signal: AbortSignal): Promise<NativeSideSession> {
  let receive: ((message: CodexRpc) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  const transport = new CodexManagedTransport(message => {
    if (message.id != null && typeof message.method === 'string') {
      transport.send({ id: message.id, error: { code: -32601, message: 'Interactive requests are unavailable in side chat.' } })
      return
    }
    receive?.(message)
  }, message => fail?.(new Error(message)))
  const stop = () => { void transport.stop().catch(() => {}) }
  signal.addEventListener('abort', stop, { once: true })
  let threadId: string
  try {
    signal.throwIfAborted()
    await transport.start({ ...launch, command: resolveCodexServerBinary(launch.command),
      args: launch.args.filter(arg => arg !== '--no-daemon'), env: codexLoopbackEnv(launch.env) })
    signal.throwIfAborted()
    const options = { cwd: launch.cwd, model: parent.model, sandbox: 'read-only', approvalPolicy: 'never',
      developerInstructions: sideChatPolicy, config: { 'features.goals': false }, ephemeral: true }
    let cursor: string | null = null
    let last: CodexRpc | undefined
    do {
      const page: CodexRpc = await transport.call('thread/turns/list', { threadId: parent.threadId, cursor, limit: 20 }).catch(error => {
        // Codex does not materialize a persisted thread on an unused composer.
        if (!cursor && !parent.truncated && !parent.items.some(item => item.type === 'agentMessage' && item.status === 'completed') &&
          error instanceof Error && error.message === `thread not loaded: ${parent.threadId}`) return { data: [] }
        throw error
      })
      if (!Array.isArray(page.data)) throw new Error('Codex returned invalid side chat history.')
      last = page.data.find((turn: CodexRpc) => turn.status === 'completed' && turn.id !== parent.turnId)
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null
      signal.throwIfAborted()
    } while (!last && cursor)
    const result = last
      ? await transport.call('thread/fork', { ...options, threadId: parent.threadId, lastTurnId: last.id, excludeTurns: true })
      : await transport.call('thread/start', options)
    threadId = result.thread?.id
    if (typeof threadId !== 'string' || threadId === parent.threadId) throw new Error('Codex did not create a separate side thread.')
    await transport.call('thread/inject_items', { threadId, items: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'This is a separate side conversation. The preceding history is background. Treat the next user message as the side question.' }] },
    ] })
  } catch (error) {
    await transport.stop()
    throw error
  } finally {
    signal.removeEventListener('abort', stop)
  }
  return {
    dispose: () => transport.stop(),
    async ask(text, publish, turnSignal) {
      turnSignal.throwIfAborted()
      let turnId: string | undefined
      let interrupting: Promise<unknown> | undefined
      let interruptTimer: ReturnType<typeof setTimeout> | undefined
      const interrupt = () => {
        if (!turnId || interrupting) return
        interruptTimer = setTimeout(() => fail?.(new Error('Codex did not confirm the side turn stopped.')), 10_000)
        interrupting = transport.call('turn/interrupt', { threadId, turnId })
        void interrupting.catch(error => fail?.(error))
      }
      const parts = new Map<string, string>()
      let answer = ''
      let finish!: () => void
      const completed = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
      void completed.catch(() => {})
      const timer = setTimeout(() => fail?.(new Error('Codex side question timed out.')), 10 * 60_000)
      turnSignal.addEventListener('abort', interrupt, { once: true })
      receive = ({ method, params }) => {
        if (params?.threadId !== threadId || (turnId && (params.turnId ?? params.turn?.id) !== turnId)) return
        if (method === 'turn/started') {
          turnId = params.turn?.id
          if (turnSignal.aborted) interrupt()
        } else if (method === 'item/agentMessage/delta' || (method === 'item/completed' && params.item?.type === 'agentMessage')) {
          const id = params.itemId ?? params.item.id
          parts.set(id, (method === 'item/completed' ? params.item.text : (parts.get(id) ?? '') + params.delta).slice(0, 64_000))
          answer = [...parts.values()].join('\n\n').slice(0, 64_000)
          publish(answer)
        } else if (method === 'turn/completed') {
          if (params.turn?.status === 'failed') fail?.(new NativeSideTurnError(params.turn.error?.message ?? 'Codex side question failed.'))
          else finish()
        }
      }
      try {
        const result = await transport.call('turn/start', { threadId,
          input: [{ type: 'text', text, text_elements: [] }], environments: [],
          ...(parent.effort && parent.effort !== 'default' ? { effort: parent.effort } : {}) })
        turnId = result.turn?.id
        if (!turnId) throw new Error('Codex did not start a side turn.')
        if (turnSignal.aborted) interrupt()
        await completed
        await interrupting
        return answer
      } finally {
        receive = undefined; fail = undefined
        clearTimeout(timer)
        clearTimeout(interruptTimer)
        turnSignal.removeEventListener('abort', interrupt)
      }
    },
  }
}
