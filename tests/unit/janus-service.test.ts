import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JanusAPI } from '../../src/shared/ipc/janus'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'

const janus = {
  listBlueprints: vi.fn(),
  applyAnalysisPatch: vi.fn(),
  onAnalysisResult: vi.fn(),
} as unknown as JanusAPI

let service: typeof import('../../src/renderer/src/services/blueprint')

beforeAll(async () => {
  vi.stubGlobal('window', { electron: { janus } })
  service = await import('../../src/renderer/src/services/blueprint')
})

describe('Blueprint renderer service', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['listBlueprints', 'listBlueprints', ['C:\\repo'], [{ id: 'bp-1' }] as Blueprint[]],
    ['applyAnalysisPatch', 'applyAnalysisPatch', [{ workspacePath: 'C:\\repo', blueprintId: 'bp-1', nodeId: 'node-1', patch: { progress: 50 } }], null],
    ['onAnalysisResult', 'onAnalysisResult', [vi.fn()], vi.fn()],
  ] as const)('%s is a thin passthrough to the Janus API', async (method, apiMethod, args, mockReturn) => {
    vi.mocked(janus[apiMethod]).mockReturnValue(mockReturn as never)

    const result = await (service[method] as (...a: unknown[]) => unknown)(...args)
    expect(result).toBe(mockReturn)
    expect(janus[apiMethod]).toHaveBeenCalledWith(...args)
  })
})
