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
    expect(state).toMatchObject({ started: false, restoreTab: false })
    if (initial?.includes('390')) expect(state.workersWidth).toBe(390)
    state.start()
    vi.resetModules()
    expect(await load()).toMatchObject({ started: true, restoreTab: true })
  },
)

it('keeps legacy Worker notifications available without restoring a tab the user never opened', async () => {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ modeVersion: 1, agentMode: 'superagent' }) })
  const { useSuperAgentUIStore } = await import('../../src/renderer/src/stores/superagent-ui')
  expect(useSuperAgentUIStore.getState()).toMatchObject({ started: true, restoreTab: false })
})
