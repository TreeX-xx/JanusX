import { createUserMessage } from '__DSH_LLM_URL__'
import { bridge } from './native-bridge.mjs'

export const inject = ['agents']
export function apply(ctx) {
  let active, turnId = '', step = 0, text = '', reasoning = ''
  const link = bridge(async command => {
    if (!active || String(active.session.id) !== command.sessionId) throw new Error('DSH session changed')
    if (command.type === 'interrupt') {
      if (command.turnId !== turnId) throw new Error('DSH turn changed')
      active.cancel({ kind: 'user' })
    } else {
      if (active.status !== 'idle') throw new Error('DSH is busy')
      active.followup(createUserMessage({ content: [{ type: 'text', text: command.text }], source: { kind: 'user' } }))
    }
  })
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
  // The native TUI remains the approval owner; this observer never grants permission.
  ctx.on('approval/request', async (_request, next) => {
    link.emit({ type: 'attention', pending: true })
    try { return await next() } finally { link.emit({ type: 'attention', pending: false }) }
  })
  ctx.on('dispose', () => link.stop())
}
