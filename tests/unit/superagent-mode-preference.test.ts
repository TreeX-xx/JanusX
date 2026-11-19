import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it.each([null, '{', JSON.stringify({ started: true, agentMode: 'superagent', workersWidth: 390 })])(
  'requires a fresh choice to restore orchestration from %s', async initial => {
    let saved = initial
    vi.stubGlobal('localStorage', {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value },
    })
    const load = async () => (await import('../../src/renderer/src/stores/superagent-ui')).useSuperAgentUIStore.getState()
    const state = await load()
    expect(state).toMatchObject({ agentMode: 'ordinary', started: false })
    if (initial?.includes('390')) expect(state.workersWidth).toBe(390)
    state.setAgentMode('superagent')
    vi.resetModules()
    expect((await load()).agentMode).toBe('superagent')
  },
)
