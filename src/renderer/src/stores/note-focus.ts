// Note: passive scope and explicit navigation stay separate — see .agents/notes/blueprint/navigation/requirements/module-focus-navigation.md
import { create } from 'zustand'
import type { NoteBrowserState, NoteFocusAction, NoteFocusEvent, NoteScopeItem } from '../../../shared/note-chat'
import { sameCheckoutPath } from '../lib/checkout-path'

export interface WorkingScope { workspacePath: string; notes: NoteScopeItem[]; excluded: string[] }
export const useNoteFocusStore = create<{
  scopes: Record<string, WorkingScope>
  history: NoteFocusEvent[]
  display: NoteFocusEvent | null
  displays: Record<string, NoteFocusEvent>
  activeConversationId: string | null
  browser: NoteBrowserState | null
  setBrowser: (browser: NoteBrowserState | null) => void
  activate: (conversationId: string | null) => void
  receive: (event: NoteFocusEvent) => void
  locate: (event: NoteFocusEvent, action?: NoteFocusAction) => void
  remove: (conversationId: string, uri: string) => void
  pin: (conversationId: string, uri: string) => void
  clear: (conversationId: string, forgetHistory?: boolean) => void
}>((set) => ({
  scopes: {}, history: [], display: null, displays: {}, activeConversationId: null, browser: null,
  setBrowser: browser => set(state => JSON.stringify(state.browser) === JSON.stringify(browser) ? state : { browser }),
  activate: activeConversationId => set(state => {
    const cached = activeConversationId ? state.displays[activeConversationId] : undefined
    return { activeConversationId, display: cached ? { ...cached, focus: 'none' } : null }
  }),
  receive: event => set(state => {
    if (event.mode !== 'display') event = { ...event, focus: 'none', action: undefined }
    const sameAccess = (item: NoteFocusEvent) => event.mode === 'access' && !!event.turnId
      && item.mode === 'access' && item.turnId === event.turnId && item.conversationId === event.conversationId
      && sameCheckoutPath(item.workspacePath, event.workspacePath)
    const previousAccess = state.history.find(sameAccess)
    if (previousAccess) {
      const merged = new Map(previousAccess.notes.map(note => [note.uri, note]))
      for (const note of event.notes) {
        const previous = merged.get(note.uri)
        merged.set(note.uri, previous?.role === 'target' && note.role !== 'target' ? previous : note)
      }
      event = { ...event, id: previousAccess.id, notes: [...merged.values()].slice(-32) }
    }
    const previous = state.scopes[event.conversationId]
    const old = previous && sameCheckoutPath(previous.workspacePath, event.workspacePath) ? previous : undefined
    const excluded = old?.excluded ?? []
    const pins = old?.notes.filter(note => note.pinned) ?? []
    const preserved = event.mode === 'access' ? (old?.notes ?? pins).map(note => !note.pinned && event.notes.some(item => item.uri === note.uri && item.role === 'target')
      ? { ...note, role: 'target' as const } : note) : pins
    const notes = event.mode === 'scope' || event.focus === 'none' ? [...preserved, ...event.notes.filter(note => !excluded.includes(note.uri) && !preserved.some(pin => pin.uri === note.uri))].slice(0, 32) : event.notes
    const effective = { ...event, notes }
    const display = { ...effective, focus: event.mode === 'display' && event.focus === 'explicit' ? 'explicit' as const : 'none' as const }
    return {
      scopes: event.mode === 'scope' ? { ...state.scopes, [event.conversationId]: { workspacePath: event.workspacePath, notes, excluded } } : state.scopes,
      history: [...state.history.filter(item => item.id !== event.id), event.mode === 'access' ? event : effective].slice(-100),
      displays: { ...state.displays, [event.conversationId]: display },
      display: state.activeConversationId === event.conversationId ? display : state.display,
    }
  }),
  locate: (event, action = 'locate') => set(state => {
    const display: NoteFocusEvent = { ...event, id: crypto.randomUUID(), focus: 'explicit', mode: 'display', action }
    return { displays: { ...state.displays, [event.conversationId]: display },
      display: state.activeConversationId === event.conversationId ? display : state.display }
  }),
  remove: (conversationId, uri) => set(state => {
    const scope = state.scopes[conversationId]
    if (!scope) return state
    const notes = scope.notes.filter(note => note.uri !== uri)
    const cached = state.displays[conversationId]
    return { displays: cached ? { ...state.displays, [conversationId]: { ...cached, notes: cached.notes.filter(note => note.uri !== uri), focus: 'none' } } : state.displays,
      scopes: { ...state.scopes, [conversationId]: { ...scope, notes, excluded: [...new Set([...scope.excluded, uri])] } },
      display: state.display?.conversationId === conversationId ? { ...state.display, notes: state.display.notes.filter(note => note.uri !== uri), focus: 'none' } : state.display }
  }),
  pin: (conversationId, uri) => set(state => {
    const scope = state.scopes[conversationId]
    if (!scope) return state
    return { scopes: { ...state.scopes, [conversationId]: { ...scope, notes: scope.notes.map(note => note.uri === uri ? { ...note, pinned: !note.pinned } : note) } } }
  }),
  clear: (conversationId, forgetHistory = false) => set(state => ({ displays: Object.fromEntries(Object.entries(state.displays).filter(([id]) => id !== conversationId)), scopes: { ...state.scopes, [conversationId]: { workspacePath: state.scopes[conversationId]?.workspacePath ?? '', notes: [], excluded: [] } }, display: state.display?.conversationId === conversationId ? null : state.display,
    history: forgetHistory ? state.history.filter(event => event.conversationId !== conversationId) : state.history })),
}))
