import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers'
import { bridge } from './native-bridge.mjs'

export default function (pi) {
  let context, turnId = '', assistantId = '', userId = ''
  const link = bridge(async command => {
    if (!context) throw new Error('Pi is starting')
    if (command.type === 'interrupt') {
      if (command.turnId !== turnId) throw new Error('Pi turn changed')
      await context.abort()
    } else {
      if (!context.isIdle() || context.hasPendingMessages()) throw new Error('Pi is busy')
      pi.sendUserMessage(command.text)
    }
  })
  function message(event, done) {
    const msg = event.message
    if (!msg || !['user', 'assistant', 'toolResult'].includes(msg.role)) return
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content ?? []
    const base = msg.role === 'user' ? userId : msg.role === 'assistant' ? assistantId : `tool:${msg.toolCallId}`
    const status = done ? (msg.stopReason === 'aborted' ? 'interrupted' : msg.stopReason === 'error' || msg.isError ? 'failed' : 'completed') : 'inProgress'
    if (done && msg.errorMessage) link.emit({ type: 'item', item: { id: `${base}:error`, turnId, type: 'error', text: msg.errorMessage, status: 'failed' } })
    if (msg.role === 'toolResult') {
      link.emit({ type: 'item', item: { id: base, turnId, type: 'commandExecution', text: `${msg.toolName ?? 'Tool'}\n${blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')}`, status } })
      return
    }
    for (const [kind, type] of [['text', msg.role === 'user' ? 'userMessage' : 'agentMessage'], ['thinking', 'reasoning']]) {
      const text = blocks.filter(b => b.type === kind).map(b => kind === 'text' ? b.text : b.thinking).join('\n')
      if (text) link.emit({ type: 'item', item: { id: `${base}:${kind}`, turnId, type, text, status } })
    }
    for (const block of blocks.filter(b => b.type === 'toolCall')) link.emit({ type: 'item', item: {
      id: `tool:${block.id}`, turnId, type: 'commandExecution', text: `${block.name}\n${JSON.stringify(block.arguments ?? {})}`, status: 'inProgress',
    } })
  }
  pi.on('session_start', (_event, ctx) => {
    context = ctx
    link.emit({ type: 'session', sessionId: ctx.sessionManager.getSessionId(), path: ctx.sessionManager.getSessionFile(), model: ctx.model?.id })
  })
  pi.on('agent_start', (_event, ctx) => {
    context = ctx
    if (!turnId) { turnId = randomUUID(); link.emit({ type: 'start', turnId }) }
  })
  pi.on('message_start', event => {
    if (!turnId) { turnId = randomUUID(); link.emit({ type: 'start', turnId }) }
    if (event.message.role === 'assistant') assistantId = randomUUID()
    if (event.message.role === 'user') userId = randomUUID()
    message(event, false)
  })
  pi.on('message_update', event => message(event, false))
  pi.on('message_end', event => message(event, true))
  pi.on('agent_settled', () => { link.emit({ type: 'end' }); turnId = '' })
  pi.on('session_shutdown', () => { link.emit({ type: 'error', error: 'Pi session closed or switched; create a new dual-mode terminal.' }); setTimeout(link.stop, 150) })
}
