import { describe, expect, it, vi } from 'vitest'
import type { NativeSideChatOwner } from '../../src/shared/conversation-side-chat'
import type { ConversationController } from '../../src/main/terminal/conversations'
import { NativeSideChats, NativeSideTurnError, validateSideChatCommand } from '../../src/main/terminal/native-side-chat'

function parent(terminalId: string) {
  const owner: NativeSideChatOwner = { terminalId, threadId: 'parent' }
  const controller = { state: { id: terminalId, threadId: owner.threadId, connection: 'ready' } } as ConversationController
  return { owner, controller }
}

describe('native side chat ownership', () => {
  it('reuses the child and stops only the matching terminal and turn', async () => {
    const chats = new NativeSideChats()
    const a = parent('a'), b = parent('b')
    const signals = new Map<string, AbortSignal>()
    const pending = new Map<string, (text: string) => void>()
    const makeSession = () => ({
      ask: vi.fn((text: string, publish: (text: string) => void, signal: AbortSignal) => new Promise<string>(resolve => {
        signals.set(text, signal)
        pending.set(text, resolve)
        signal.addEventListener('abort', () => resolve('partial'), { once: true })
        publish(text + ' partial')
      })),
      dispose: vi.fn(async () => {}),
    })
    const aSide = makeSession(), bSide = makeSession()
    const open = vi.fn(async () => aSide)
    chats.bind(a.controller, open)
    chats.bind(b.controller, async () => bSide)
    const publish = vi.fn()
    const first = chats.command(a.controller, { type: 'ask', owner: a.owner, requestId: 'first', text: 'A' }, publish)
    const second = chats.command(b.controller, { type: 'ask', owner: b.owner, requestId: 'first', text: 'B' }, publish)
    await vi.waitFor(() => expect(pending.size).toBe(2))
    await chats.command(a.controller, { type: 'stop', owner: a.owner, requestId: 'stale' }, publish)
    expect(signals.get('A')?.aborted).toBe(false)
    await chats.command(a.controller, { type: 'stop', owner: a.owner, requestId: 'first' }, publish)
    await expect(first).resolves.toEqual({ status: 'stopped', text: 'partial' })
    expect(signals.get('B')?.aborted).toBe(false)
    expect(publish).toHaveBeenCalledWith({ owner: b.owner, requestId: 'first', text: 'B partial' })
    pending.get('B')?.('B done')
    await expect(second).resolves.toEqual({ status: 'done', text: 'B done' })
    const next = chats.command(a.controller, { type: 'ask', owner: a.owner, requestId: 'next', text: 'Follow-up' }, publish)
    pending.get('Follow-up')?.('A again')
    await expect(next).resolves.toEqual({ status: 'done', text: 'A again' })
    expect(open).toHaveBeenCalledTimes(1)
    await chats.dispose(a.controller)
    expect(aSide.dispose).toHaveBeenCalledOnce()
    expect(bSide.dispose).not.toHaveBeenCalled()
  })

  it('disposes a child that arrives after the parent switches', async () => {
    const { controller, owner } = parent('a')
    const chats = new NativeSideChats()
    const publish = vi.fn()
    const session = { ask: vi.fn(), dispose: vi.fn(async () => {}) }
    let resolveOpening!: (value: typeof session) => void
    chats.bind(controller, () => new Promise(resolve => { resolveOpening = resolve }))
    const question = chats.command(controller, { type: 'ask', owner, requestId: 'first', text: 'A' }, publish)
    controller.state.threadId = 'replacement'
    const cleanup = chats.reconcile(controller, 'replacement')
    resolveOpening(session)
    await expect(question).resolves.toEqual({ status: 'stopped', text: '' })
    await cleanup
    expect(session.dispose).toHaveBeenCalledOnce()
    expect(session.ask).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('keeps a confirmed idle child after its provider fails a turn', async () => {
    const { controller, owner } = parent('a')
    const chats = new NativeSideChats()
    const session = {
      ask: vi.fn().mockRejectedValueOnce(new NativeSideTurnError('Provider unavailable')).mockResolvedValueOnce('Recovered'),
      dispose: vi.fn(async () => {}),
    }
    const open = vi.fn(async () => session)
    chats.bind(controller, open)
    const ask = (requestId: string) => chats.command(controller, { type: 'ask', owner, requestId, text: 'Explain' }, vi.fn())
    await expect(ask('first')).rejects.toThrow('Provider unavailable')
    await expect(ask('retry')).resolves.toEqual({ status: 'done', text: 'Recovered' })
    expect(open).toHaveBeenCalledOnce()
    expect(session.dispose).not.toHaveBeenCalled()
    await chats.dispose(controller)
  })

  it('validates native scoped commands at the IPC boundary', () => {
    const { owner } = parent('terminal')
    const request = { type: 'ask', owner, requestId: 'question', text: 'How?' }
    expect(validateSideChatCommand(request)).toEqual(request)
    expect(() => validateSideChatCommand({ ...request, text: '' })).toThrow()
    expect(() => validateSideChatCommand({ ...request, owner: { ...owner, threadId: null } })).toThrow()
    expect(() => validateSideChatCommand({ ...request, requestId: '\x00' })).toThrow()
  })
})
