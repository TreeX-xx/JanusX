import React from 'react'
import { createRoot } from 'react-dom/client'
import { AutomationPanel } from '../../../src/renderer/src/components/automations/AutomationPanel'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { receiveAutomationDraft, useAutomationsStore } from '../../../src/renderer/src/stores/automations'
import { automationInputSchema, dailyReviewTemplate, type AutomationCard, type AutomationDefinition, type AutomationRun, type AutomationsAPI } from '../../../src/shared/automations'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

let cards: AutomationDefinition[] = [], runs: AutomationRun[] = []
let groups: AutomationCard[] = []
const listeners = new Set<() => void>()
const removed = new Set<(id: string) => void>()
const api: AutomationsAPI = {
  listCards: async () => structuredClone(groups),
  saveCard: async (name, id, revision) => {
    const previous = groups.find(card => card.id === id)
    if (id && previous?.revision !== revision) throw new Error('revision_conflict')
    const group = { id: id ?? crypto.randomUUID(), name, revision: (revision ?? 0) + 1, createdAt: new Date().toISOString() }
    groups = [...groups.filter(card => card.id !== group.id), group]; listeners.forEach(fn => fn()); return group
  },
  removeCard: async (id, revision) => {
    if (groups.find(card => card.id === id)?.revision !== revision) throw new Error('revision_conflict')
    const children = cards.filter(task => task.cardId === id)
    for (const task of children) await api.remove(task.id, task.revision)
    groups = groups.filter(card => card.id !== id); listeners.forEach(fn => fn())
  },
  list: async () => structuredClone(cards),
  save: async (input, id, revision) => {
    automationInputSchema.parse(input)
    const prior = cards.find(card => card.id === id)
    if (id && prior?.revision !== revision) throw new Error('revision_conflict')
    const group = input.cardId ? groups.find(card => card.id === input.cardId) : await api.saveCard(input.name)
    if (!group) throw new Error('Automation card not found')
    group.revision++
    const card = { ...input, cardId: group.id, id: id ?? crypto.randomUUID(), revision: (revision ?? 0) + 1, root: '/fixture', createdAt: new Date().toISOString(), nextRunAt: null }
    cards = [...cards.filter(item => item.id !== card.id), card]; listeners.forEach(fn => fn()); return card
  },
  preview: async () => ({ root: '/fixture', base: '1'.repeat(40), head: '2'.repeat(40), files: ['example.ts'], noChanges: false }),
  run: async id => {
    const run: AutomationRun = { id: crypto.randomUUID(), definitionId: id, occurrenceKey: 'fixture', trigger: 'manual', state: 'running', snapshot: cards.find(card => card.id === id)!,
      startedAt: new Date().toISOString(), cursor: { commit: '1'.repeat(40), epoch: 1, partialCount: 0, attention: false }, tasks: [] }
    runs.push(run); listeners.forEach(fn => fn()); return run
  },
  history: async id => structuredClone(runs.filter(run => run.definitionId === id)),
  cancel: async id => { runs = runs.map(run => run.id === id ? { ...run, state: 'cancelled', finishedAt: new Date().toISOString() } : run); listeners.forEach(fn => fn()) },
  remove: async (id, revision) => {
    if (cards.find(card => card.id === id)?.revision !== revision) throw new Error('revision_conflict')
    const group = groups.find(group => group.id === cards.find(card => card.id === id)?.cardId)
    if (group) group.revision++
    cards = cards.filter(card => card.id !== id); runs = runs.filter(run => run.definitionId !== id)
    removed.forEach(fn => fn(id)); listeners.forEach(fn => fn())
  },
  onRemoved: callback => { removed.add(callback); return () => { removed.delete(callback) } },
  onChanged: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
  onDraft: () => () => {}, onCompleted: () => () => {}, onFocus: () => () => {},
}
Object.assign(window, { electron: { automations: api, llm: { getTerminalDefault: async () => ({ provider: { id: 'fixture-provider' }, modelId: 'fixture-model' }) } } })
Object.assign(window, { automationFixture: { receiveDraft: receiveAutomationDraft } })
useWorkspaceStore.setState({ activeWorkspaceId: 'project', workspaces: [{ id: 'project', name: 'Fixture project', path: '/fixture', clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '' }] })
const params = new URLSearchParams(location.search)
useThemeStore.getState().applyExternal(params.get('theme') === 'planche' ? 'planche' : 'dark')
const panelWidth = Number(params.get('width') ?? 420)
function Harness() {
  const [visible, setVisible] = React.useState(true)
  return <><div style={{ display: 'flex', gap: 12, padding: 8 }}><button onClick={() => setVisible(!visible)}>Toggle panel</button><button onClick={() => {
    const input = { ...dailyReviewTemplate('project'), providerId: 'fixture-provider', modelId: 'fixture-model' }; useAutomationsStore.getState().setDraft({ input })
  }}>Receive chat draft</button></div><div style={{ width: panelWidth, height: 680, background: 'var(--tool-canvas)', '--shell-canvas': 'var(--tool-canvas)' } as React.CSSProperties}>{visible && <AutomationPanel />}</div></>
}
void initI18n().then(() => changeLanguage(params.get('lang') === 'en' ? 'en' : 'zh-CN')).then(() => createRoot(document.getElementById('root')!).render(<Harness />))
