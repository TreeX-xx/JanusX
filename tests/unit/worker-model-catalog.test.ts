import { beforeEach, expect, it, vi } from 'vitest'
import { readWorkerModelCatalog, WorkerModelCatalog } from '../../src/main/janus/superagent/worker-model-catalog'

const mocks = vi.hoisted(() => ({ find: vi.fn(), start: vi.fn(), call: vi.fn(), stop: vi.fn(), claude: vi.fn() }))
vi.mock('../../src/main/external-cli/cli-detector', () => ({ CliDetector: class { findCandidate = mocks.find } }))
vi.mock('../../src/main/external-cli/managed-paths', () => ({ managedCliEnv: () => ({ NATIVE_CONFIG: 'preserved' }) }))
vi.mock('../../src/main/terminal/codex-conversation', () => ({ resolveCodexServerBinary: (command: string) => command }))
vi.mock('../../src/main/terminal/claude-conversation', () => ({ resolveClaudeBinary: (command: string) => command }))
vi.mock('../../src/main/terminal/claude-models', () => ({ readClaudeCatalog: mocks.claude }))
vi.mock('../../src/main/terminal/codex-managed-transport', () => ({ CodexManagedTransport: class { start = mocks.start; call = mocks.call; stop = mocks.stop } }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.find.mockResolvedValue({ path: 'native-cli' })
  mocks.start.mockResolvedValue(undefined); mocks.stop.mockResolvedValue(undefined)
})

it('queries native Codex pages without starting a thread or changing configuration', async () => {
  mocks.call.mockResolvedValueOnce({ data: [{ model: 'native-a', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high' }, { model: 'hidden', hidden: true }], nextCursor: 'page2' })
    .mockResolvedValueOnce({ data: [{ model: 'native-b', displayName: 'Native B' }], nextCursor: null })
  const models = await readWorkerModelCatalog('codex')
  expect(models.map(row => row.model)).toEqual(['native-a', 'native-b'])
  expect(models[0]).toMatchObject({ defaultEffort: 'high', efforts: [{ effort: 'high' }] })
  expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ command: 'native-cli', args: [], env: { NATIVE_CONFIG: 'preserved' } }))
  expect(mocks.call.mock.calls).toEqual([['model/list', { limit: 100 }], ['model/list', { limit: 100, cursor: 'page2' }]])
  expect(mocks.stop).toHaveBeenCalledOnce()
})

it('reads Claude native capabilities with hooks disabled and no prompt', async () => {
  const models = [{ model: 'native-claude', efforts: [{ effort: 'high', description: '' }] }]
  mocks.claude.mockResolvedValue({ models })
  expect(await readWorkerModelCatalog('claude')).toEqual(models)
  expect(mocks.claude).toHaveBeenCalledWith(expect.objectContaining({ binary: 'native-cli', env: { NATIVE_CONFIG: 'preserved' }, settings: '{"disableAllHooks":true}' }))
  expect(mocks.start).not.toHaveBeenCalled()
})

it('stops discovery after failure and rejects repeated pagination', async () => {
  mocks.call.mockResolvedValue({ data: [], nextCursor: 'repeat' })
  await expect(readWorkerModelCatalog('codex')).rejects.toThrow('pagination')
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(mocks.stop).toHaveBeenCalledOnce()
  mocks.start.mockRejectedValueOnce(new Error('Native login failed'))
  await expect(readWorkerModelCatalog('codex')).rejects.toThrow('Native login failed')
  expect(mocks.stop).toHaveBeenCalledTimes(2)
})

it('does not invent models when the native CLI is unavailable', async () => {
  mocks.find.mockResolvedValue(undefined)
  await expect(readWorkerModelCatalog('claude')).rejects.toThrow('not installed')
  expect(mocks.claude).not.toHaveBeenCalled()
})

it('deduplicates in-flight reads but refreshes after failure and completion', async () => {
  const first = Promise.withResolvers<[]>()
  const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([])
  const catalog = new WorkerModelCatalog(read)
  const a = catalog.get('codex'), b = catalog.get('codex')
  expect(a).toBe(b)
  await catalog.get('claude')
  first.reject(new Error('offline'))
  await expect(a).rejects.toThrow('offline')
  await catalog.get('codex')
  expect(read.mock.calls).toEqual([['codex'], ['claude'], ['codex']])
  await expect(catalog.get('shell')).rejects.toThrow('Unsupported')
  expect(read).toHaveBeenCalledTimes(3)
})
