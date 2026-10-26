import { beforeEach, describe, expect, it } from 'vitest'
import { useNoteFocusStore } from '../../src/renderer/src/stores/note-focus'
import { resolveFocusNodes } from '../../src/renderer/src/features/blueprint/note-focus'
import type { NoteFocusEvent } from '../../src/shared/note-chat'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'

const event = (id: string, uris = ['note://repo/a', 'note://repo/b']): NoteFocusEvent => ({ id, conversationId: 'chat', workspacePath: 'C:/project', mode: 'scope', focus: 'auto', reason: 'Related work', notes: uris.map((uri, i) => ({ uri, title: uri, role: i ? 'reference' : 'target', reason: 'Relevant' })) })
beforeEach(() => useNoteFocusStore.setState({ scopes: {}, history: [], display: null, displays: {}, activeConversationId: 'chat', browser: null }))
describe('assistant visual scope', () => {
  it('merges paged access by turn, document and checkout without losing write roles', () => {
    const state = useNoteFocusStore.getState()
    const read = { ...event('read'), mode: 'access' as const, turnId: 'turn-1' }
    state.receive(read)
    state.receive({ ...read, id: 'page-2', notes: [read.notes[0], read.notes[0]] })
    expect(useNoteFocusStore.getState().history).toHaveLength(1)
    expect(useNoteFocusStore.getState().history[0].notes).toHaveLength(2)
    state.receive({ ...read, id: 'page-3', notes: [{ ...read.notes[0], role: 'reference' }] })
    expect(useNoteFocusStore.getState().history[0].notes[0].role).toBe('target')
    state.receive({ ...read, id: 'next', turnId: 'turn-2' })
    state.receive({ ...read, id: 'other-chat', conversationId: 'other' })
    state.receive({ ...read, id: 'other-root', workspacePath: 'C:/other' })
    expect(useNoteFocusStore.getState().history).toHaveLength(4)
  })
  it('preserves semantic scope while recording later reads and isolates same-checkout conversations', () => {
    const state = useNoteFocusStore.getState()
    state.activate('chat')
    state.receive(event('scope', ['note://repo/a']))
    state.receive({ ...event('read', ['note://repo/b']), mode: 'access', focus: 'none' })
    expect(useNoteFocusStore.getState().scopes.chat.notes.map(note => note.uri)).toEqual(['note://repo/a'])
    expect(useNoteFocusStore.getState().display?.notes.map(note => note.uri)).toEqual(['note://repo/a', 'note://repo/b'])
    state.receive({ ...event('background', ['note://repo/z']), conversationId: 'other' })
    expect(useNoteFocusStore.getState().display?.conversationId).toBe('chat')
    state.activate('other')
    expect(useNoteFocusStore.getState().display?.notes[0].uri).toBe('note://repo/z')
    state.activate('chat')
    expect(useNoteFocusStore.getState().display?.notes).toHaveLength(2)
    state.activate(null)
    state.receive(event('closed'))
    expect(useNoteFocusStore.getState().display).toBeNull()
  })
  it('automatic access highlights respect pins and exclusions without replacing scope', () => {
    const state = useNoteFocusStore.getState()
    state.receive(event('one'))
    state.pin('chat', 'note://repo/a')
    state.remove('chat', 'note://repo/b')
    const scope = useNoteFocusStore.getState().scopes.chat
    state.receive({ ...event('access', ['note://repo/b', 'note://repo/c']), mode: 'display', focus: 'none' })
    expect(useNoteFocusStore.getState().display?.notes.map(note => note.uri)).toEqual(['note://repo/a', 'note://repo/c'])
    expect(useNoteFocusStore.getState().scopes.chat).toBe(scope)
  })
  it('retains user pins and exclusions across assistant updates', () => {
    const state = useNoteFocusStore.getState()
    state.receive(event('one'))
    state.pin('chat', 'note://repo/a')
    state.remove('chat', 'note://repo/b')
    state.receive(event('two', ['note://repo/b', 'note://repo/c']))
    expect(useNoteFocusStore.getState().scopes.chat.notes.map(note => note.uri)).toEqual(['note://repo/a', 'note://repo/c'])
    expect(useNoteFocusStore.getState().scopes.chat.notes[0].pinned).toBe(true)
  })
  it('scope updates never navigate, and history location does not replace scope', () => {
    const state = useNoteFocusStore.getState()
    state.receive(event('one'))
    expect(useNoteFocusStore.getState().display?.focus).toBe('none')
    state.receive(event('two'))
    expect(useNoteFocusStore.getState().display?.focus).toBe('none')
    const scope = useNoteFocusStore.getState().scopes.chat
    state.locate(event('old', ['note://repo/z']))
    expect(useNoteFocusStore.getState().scopes.chat).toBe(scope)
    expect(useNoteFocusStore.getState().display?.focus).toBe('explicit')
  })
  it('never replays navigation when activating a conversation with cached display intent', () => {
    const state = useNoteFocusStore.getState()
    state.receive({ ...event('one'), mode: 'display', action: 'enter', focus: 'explicit' })
    expect(useNoteFocusStore.getState().display?.action).toBe('enter')
    state.activate('other')
    state.activate('chat')
    expect(useNoteFocusStore.getState().display?.focus).toBe('none')
    state.receive({ ...event('passive'), focus: 'explicit' })
    expect(useNoteFocusStore.getState().display?.focus).toBe('none')
  })
  it('resolves exact URI and checkout, reports ambiguous and missing nodes', () => {
    const blueprint = { nodeIds: ['a', 'b', 'other'], nodes: { a: { sourceUri: 'note://repo/a' }, b: { sourceUri: 'note://repo/b' }, other: { sourceUri: 'note://repo/a' } }, composition: { nodes: { other: { path: 'C:/other' } } } } as unknown as Blueprint
    expect([...resolveFocusNodes(blueprint, 'C:/project', event('one')).roles.keys()]).toEqual(['a', 'b'])
    blueprint.composition!.nodes.other.path = 'C:/project'
    expect(resolveFocusNodes(blueprint, 'C:/project', event('one')).missing).toEqual(['note://repo/a'])
    expect(resolveFocusNodes(blueprint, 'C:/wrong', event('two', ['note://repo/z'])).roles.size).toBe(0)
  })
  it('clearing a conversation removes its history and highlight only', () => {
    const state = useNoteFocusStore.getState()
    state.receive(event('one'))
    state.receive({ ...event('other'), conversationId: 'other' })
    state.clear('chat', true)
    expect(useNoteFocusStore.getState().history.map(item => item.conversationId)).toEqual(['other'])
    expect(useNoteFocusStore.getState().scopes.chat.notes).toEqual([])
  })
})
