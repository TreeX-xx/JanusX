import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => join(tmpdir(), 'janusx-test-user-data')) },
}))

const { ClaudeSettingsApplier } = await import('../../../src/main/external-cli/settings-applier')
const { CliDetector } = await import('../../../src/main/external-cli/cli-detector')
const { ExternalCliSyncStateStore } = await import('../../../src/main/external-cli/sync-state')
const { DefaultExternalCliService } = await import('../../../src/main/external-cli/service')

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

type Credentials = { providerId: string; providerName: string; baseURL: string; authToken: string; model?: string }

function createService(homeDir: string, userDataDir: string, credentials: Credentials | null) {
  const detectors = {
    claude: new CliDetector('claude', {
      env: {},
      platform: 'linux' as const,
      homeDir,
      isRegularFile: async () => false,
      run: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    }),
  }
  return new DefaultExternalCliService(
    detectors,
    new ClaudeSettingsApplier(homeDir),
    new ExternalCliSyncStateStore(userDataDir),
    async () => credentials,
  )
}

const CREDENTIALS: Credentials = {
  providerId: 'openai-1',
  providerName: 'Relay',
  baseURL: 'https://relay.example.com/v1',
  authToken: 'sk-test',
  model: 'm',
}

describe('ExternalCliService provider sync', () => {
  it('applies provider credentials and records the sync source', async () => {
    const homeDir = await createTempDir('janusx-cc-llm-home-')
    const userDataDir = await createTempDir('janusx-cc-llm-data-')
    const service = createService(homeDir, userDataDir, CREDENTIALS)

    const result = await service.applyProvider('claude', null)
    expect(result).toMatchObject({ success: true, providerName: 'Relay' })

    const live = JSON.parse(await readFile(join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(live.env.ANTHROPIC_BASE_URL).toBe('https://relay.example.com/v1')
    expect(live.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test')

    const state = await service.syncState()
    expect(state.claude).toMatchObject({ providerId: 'openai-1', providerName: 'Relay' })
  })

  it('reports NO_LLM_PROVIDER when no usable provider exists', async () => {
    const homeDir = await createTempDir('janusx-cc-llm-none-')
    const userDataDir = await createTempDir('janusx-cc-llm-none-data-')
    const service = createService(homeDir, userDataDir, null)

    await expect(service.applyProvider('claude', null)).resolves.toEqual({ success: false, error: 'NO_LLM_PROVIDER' })
    await expect(service.syncState()).resolves.toEqual({ claude: null })
  })

  it('clears the sync record on rollback', async () => {
    const homeDir = await createTempDir('janusx-cc-llm-rb-')
    const userDataDir = await createTempDir('janusx-cc-llm-rb-data-')
    const service = createService(homeDir, userDataDir, CREDENTIALS)

    const { mkdir, writeFile } = await import('fs/promises')
    await mkdir(join(homeDir, '.claude'), { recursive: true })
    await writeFile(join(homeDir, '.claude', 'settings.json'), JSON.stringify({ env: { V: '0' } }), 'utf8')

    await service.applyProvider('claude', 'openai-1')
    await expect(service.syncState()).resolves.toMatchObject({ claude: { providerId: 'openai-1' } })

    const rolled = await service.rollbackProfile()
    expect(rolled.success).toBe(true)
    await expect(service.syncState()).resolves.toEqual({ claude: null })
  })

  it('rejects unsupported tools without touching resolvers', async () => {
    const homeDir = await createTempDir('janusx-cc-llm-tool-')
    const userDataDir = await createTempDir('janusx-cc-llm-tool-data-')
    const resolver = vi.fn(async () => CREDENTIALS)
    const detectors = {
      claude: new CliDetector('claude', {
        env: {},
        platform: 'linux' as const,
        homeDir,
        isRegularFile: async () => false,
        run: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
      }),
    }
    const service = new DefaultExternalCliService(
      detectors,
      new ClaudeSettingsApplier(homeDir),
      new ExternalCliSyncStateStore(userDataDir),
      resolver,
    )

    // codex 探测安装已支持，但凭证同步仍仅限 claude，且先于 resolver 短路。
    await expect(service.applyProvider('codex', null)).resolves.toMatchObject({ success: false })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('does not query or install the retired Janus CLI', async () => {
    const { CliInstaller } = await import('../../../src/main/external-cli/installer')
    const homeDir = await createTempDir('janusx-cc-janus-latest-home-')
    const userDataDir = await createTempDir('janusx-cc-janus-latest-data-')
    const service = new DefaultExternalCliService(
      {},
      new ClaudeSettingsApplier(homeDir),
      new ExternalCliSyncStateStore(userDataDir),
      async () => null,
      new CliInstaller({
        platform: 'linux',
        env: {},
        homeDir,
        isRegularFile: async () => false,
        run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      }),
    )
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ latest: '0.2.0' }),
    })))

    try {
      await expect(service.latest('janus')).resolves.toEqual({ toolId: 'janus' })
      await expect(service.install('janus')).resolves.toMatchObject({ success: false, error: 'Unsupported tool.' })
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps retired Janus CLI queries local when offline', async () => {
    const { CliInstaller } = await import('../../../src/main/external-cli/installer')
    const homeDir = await createTempDir('janusx-cc-janus-absent-home-')
    const userDataDir = await createTempDir('janusx-cc-janus-absent-data-')
    const service = new DefaultExternalCliService(
      {},
      new ClaudeSettingsApplier(homeDir),
      new ExternalCliSyncStateStore(userDataDir),
      async () => null,
      new CliInstaller({
        platform: 'linux',
        env: {},
        homeDir,
        isRegularFile: async () => false,
        run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      }),
    )
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    try {
      await expect(service.latest('janus')).resolves.toEqual({ toolId: 'janus', latestVersion: undefined })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
