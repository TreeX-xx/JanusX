import { createUserMessage } from '__DSH_LLM_URL__'
import { bridge } from './native-bridge.mjs'
import { nativeQuestions } from './native-questions.mjs'

export const inject = ['agents']
export function apply(ctx) {
  let active, turnId = '', step = 0, text = '', reasoning = ''
  let nativeDialogs = 0
  const questions = nativeQuestions(event => link.emit(event))
  const link = bridge(async command => {
    if (!active || String(active.session.id) !== command.sessionId) throw new Error('DSH session changed')
    if (command.type === 'display-mode') { questions.setMode(command.mode); return }
    if (command.type === 'answer') { questions.answer(command); return }
    if (command.type === 'interrupt') {
      if (command.turnId !== turnId) throw new Error('DSH turn changed')
      questions.cancel()
      active.cancel({ kind: 'user' })
    } else {
      if (active.status !== 'idle') throw new Error('DSH is busy')
      active.followup(createUserMessage({ content: [{ type: 'text', text: command.text }], source: { kind: 'user' } }))
    }
  }, questions.setMode)
  const bind = agent => {
    if (agent.session.header.origin === 'subagent') return
    if (active && active !== agent) { link.emit({ type: 'error', error: 'DSH native session changed. Create a new dual-mode terminal.' }); return }
    active = agent
    link.emit({ type: 'session', sessionId: String(agent.session.id), model: agent.options?.model })
  }
  const item = (id, type, value, status = 'inProgress') => link.emit({ type: 'item', item: { id, turnId, type, text: value, status } })
  ctx.on('agent/created', ({ agent }) => bind(agent))
  for (const agent of ctx.agents.list()) bind(agent)
  ctx.on('agent/disposed', ({ agent }) => { if (agent === active) link.emit({ type: 'error', error: 'DSH native session closed or switched.' }) })
  ctx.on('session/event', (session, event) => {
    if (!active || session !== active.session) return
    const d = event.data
    if (event.type === 'turn/start') { turnId = String(d.turn); link.emit({ type: 'start', turnId }) }
    else if (event.type === 'turn/end') { link.emit({ type: 'end', error: d.reason.error?.message, outcome: d.reason.kind === 'aborted' ? 'interrupted' : d.reason.kind === 'error' || d.reason.kind === 'blocked' ? 'failed' : 'completed' }); turnId = '' }
    else if (event.type === 'step/start') { step = d.step; text = ''; reasoning = '' }
    else if (event.type === 'user/message' && d.source?.kind === 'user') item(d.id, 'userMessage', d.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), 'completed')
    else if (event.type === 'assistant/message') {
      const status = d.interrupted ? 'interrupted' : 'completed'
      const content = d.message.content
      const finalText = content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      const finalReasoning = content.filter(b => b.type === 'reasoning').map(b => b.text).join('\n')
      if (finalText) item(`answer:${turnId}:${d.step}`, 'agentMessage', finalText, status)
      if (finalReasoning) item(`reasoning:${turnId}:${d.step}`, 'reasoning', finalReasoning, status)
    } else if (event.type === 'tool/call') item(`tool:${d.callId}`, 'commandExecution', `${d.name}\n${d.arguments}`)
    else if (event.type === 'tool/result') item(`tool:${d.message.source.callId}`, 'commandExecution', d.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), d.message.isError ? 'failed' : 'completed')
  })
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (agent !== active) return
    if (frame.type === 'start') { text = ''; reasoning = ''; return }
    if (frame.type !== 'chunk') return
    if (frame.chunk.type === 'text-delta') { text = (text + frame.chunk.text).slice(0, 32001); item(`answer:${turnId}:${step}`, 'agentMessage', text) }
    if (frame.chunk.type === 'reasoning-delta') { reasoning = (reasoning + frame.chunk.text).slice(0, 32001); item(`reasoning:${turnId}:${step}`, 'reasoning', reasoning) }
  })
  async function native(next) {
    link.emit({ type: 'attention', pending: ++nativeDialogs > 0 })
    try { return await next() } finally { link.emit({ type: 'attention', pending: --nativeDialogs > 0 }) }
  }
  ctx.on('approval/request', async (request, next) => {
    if (request.agent !== active) return next()
    const reply = await questions.ask({ turnId, itemId: request.callId ? `tool:${request.callId}` : undefined,
      questions: [{ id: 'decision', text: request.displayReason ?? request.reason ?? request.toolName,
        options: [{ id: 'yes', label: 'Yes — allow once' }, { id: 'no', label: 'No — reject' }] }] }, request.signal)
    if (reply.native) return native(next)
    return reply.cancelled ? 'cancelled' : reply.answers[0].selected[0] === 'yes' ? 'allowed-once' : 'rejected'
  })
  ctx.on('user-questions/request', async (request, next) => {
    if ((request.agent && request.agent !== active) || request.wait?.timed || !Array.isArray(request.questions) || !request.questions.length) return native(next)
    const reply = await questions.ask({ turnId, questions: request.questions.map(q => ({ id: q.id,
      text: q.question, header: q.header, detail: q.detail, multiple: q.multiSelect === true, allowText: true,
      options: (q.options ?? []).map((option, i) => ({ id: String(i), label: option.label, description: option.description })),
    })) }, request.signal)
    if (reply.native) return native(next)
    if (reply.cancelled) return { answers: [] }
    return { answers: reply.answers.map(answer => ({ id: answer.id,
      selected: answer.selected.map(id => request.questions.find(q => q.id === answer.id).options[Number(id)].label),
      ...(answer.text?.trim() ? { custom: answer.text } : {}),
    })) }
  })
  ctx.on('dispose', () => { questions.cancel(); link.stop() })
}
