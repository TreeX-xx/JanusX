import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers'
import { bridge } from './native-bridge.mjs'
import { nativeQuestions } from './native-questions.mjs'
import { storeConversationImage } from './conversation-images.mjs'
import { fileURLToPath, URL } from 'node:url'

export default function (pi) {
  let context, turnId = '', assistantId = '', userId = ''
  const questions = nativeQuestions(event => link.emit(event))
  const wrapped = new WeakSet()
  let nativeDialogs = 0
  const link = bridge(async command => {
    if (!context) throw new Error('Pi is starting')
    if (command.type === 'display-mode') { questions.setMode(command.mode); return }
    if (command.type === 'answer') { questions.answer(command); return }
    if (command.type === 'catalog') return pi.getCommands().slice(0, 1000).map(({ name, description, source, sourceInfo }) => ({ name, description, source, sourceInfo }))
    if (command.type === 'invoke') {
      if (!context.isIdle() || context.hasPendingMessages()) throw new Error('Pi is busy')
      const entry = pi.getCommands().find(row => row.name === command.name && row.source === command.source)
      if (!entry) throw new Error('Pi command changed; refresh the catalog')
      pi.sendUserMessage('/' + entry.name + (command.arguments ? ' ' + command.arguments : ''), { expandPromptTemplates: true })
    } else if (command.type === 'interrupt') {
      if (command.turnId !== turnId) throw new Error('Pi turn changed')
      questions.cancel()
      await context.abort()
    } else {
      if (!context.isIdle() || context.hasPendingMessages()) throw new Error('Pi is busy')
      pi.sendUserMessage(command.text)
    }
  }, questions.setMode)
  function wrapUI(ui) {
    if (!ui || wrapped.has(ui)) return
    wrapped.add(ui)
    if (typeof ui.custom === 'function') {
      const original = ui.custom.bind(ui)
      ui.custom = async (...args) => {
        link.emit({ type: 'attention', pending: ++nativeDialogs > 0 })
        try { return await original(...args) }
        finally { link.emit({ type: 'attention', pending: --nativeDialogs > 0 }) }
      }
    }
    for (const kind of ['confirm', 'select', 'input', 'editor']) {
      const original = ui[kind].bind(ui)
      ui[kind] = async (title, value, options) => {
        const choices = kind === 'confirm' ? ['Yes', 'No'] : kind === 'select' ? value : []
        const reply = await questions.ask({ turnId, questions: [{ id: 'answer', text: title,
          detail: kind === 'confirm' ? value : undefined,
          options: choices.map((label, i) => ({ id: String(i), label })),
          allowText: kind === 'input' || kind === 'editor', multiline: kind === 'editor',
          placeholder: kind === 'input' ? value : undefined, initialText: kind === 'editor' ? value : undefined,
          required: kind === 'confirm' || kind === 'select',
        }] }, options?.signal, options?.timeout)
        if (reply.native) {
          link.emit({ type: 'attention', pending: ++nativeDialogs > 0 })
          try { return await original(title, value, options) }
          finally { link.emit({ type: 'attention', pending: --nativeDialogs > 0 }) }
        }
        if (reply.cancelled) return kind === 'confirm' ? false : undefined
        const answer = reply.answers[0]
        return kind === 'confirm' ? answer.selected[0] === '0' : kind === 'select' ? choices[Number(answer.selected[0])] : answer.text ?? ''
      }
    }
  }
  function message(event, done) {
    const msg = event.message
    if (!msg || !['user', 'assistant', 'toolResult'].includes(msg.role)) return
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content ?? []
    const base = msg.role === 'user' ? userId : msg.role === 'assistant' ? assistantId : `tool:${msg.toolCallId}`
    if (done && msg.role !== 'user') {
      const images = blocks.filter(block => block.type === 'image').slice(0, 8)
      if (images.length) {
        const imageTurn = turnId
        void Promise.all(images.map(async (block, index) => {
          try { return await storeConversationImage(fileURLToPath(new URL('../images/', import.meta.url)), { data: block.data }) }
          catch (error) { return { id: `${base}:image:${index}`, status: 'unavailable', error: String(error).slice(0, 300) } }
        })).then(images => link.emit({ type: 'item', item: { id: `${base}:images`, turnId: imageTurn, type: 'imageOutput', text: '', status: msg.isError ? 'failed' : 'completed', images } }))
      }
    }
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
    wrapUI(ctx.ui)
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
  pi.on('session_shutdown', () => { questions.cancel(); link.emit({ type: 'error', error: 'Pi session closed or switched; create a new dual-mode terminal.' }); setTimeout(link.stop, 150) })
}
