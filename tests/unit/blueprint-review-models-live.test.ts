// Opt in: read an existing provider configuration and send only a fixed connection marker.
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const live = Boolean(process.env.BLUEPRINT_MODEL_PROBE_CONFIG && process.env.BLUEPRINT_MODEL_PROBE_PROVIDER && process.env.BLUEPRINT_MODEL_PROBE_MODEL)
const host = await vi.hoisted(async () => {
  const { mkdtempSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { root: process.env.BLUEPRINT_MODEL_PROBE_CONFIG ? mkdtempSync(join(realpathSync.native(tmpdir()), 'blueprint-model-probe-')) : '' }
})
vi.mock('electron', () => ({ app: { getPath: () => host.root, setProxy: async () => {} }, session: { fromPartition: () => null, defaultSession: null }, safeStorage: { isEncryptionAvailable: () => false } }))
import { llmService } from '../../src/main/llm/LlmService'
import { generateText } from '../../src/main/llm/ai-runtime'
import { checkReviewConfiguration } from '../../src/main/blueprint/review/models'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'

beforeAll(async () => {
  if (!live) return
  await mkdir(join(host.root, 'janusx'))
  await writeFile(join(host.root, 'janusx/llm-config.json'), await readFile(process.env.BLUEPRINT_MODEL_PROBE_CONFIG!))
})
afterAll(async () => { if (host.root) await rm(host.root, { recursive: true, force: true }) })

it.skipIf(!live)('live connection probe distinguishes truncated reasoning from provider failure', async () => {
  const model = await llmService.getLanguageModel('janus', process.env.BLUEPRINT_MODEL_PROBE_PROVIDER!, process.env.BLUEPRINT_MODEL_PROBE_MODEL!)
  for (const maxTokens of [32, 1024]) {
    const result = await generateText({ model, prompt: 'Connection test. Reply with OK.', maxTokens, maxRetries: 0, abortSignal: AbortSignal.timeout(30000) })
    console.log(JSON.stringify({ model: process.env.BLUEPRINT_MODEL_PROBE_MODEL, maxTokens, finishReason: result.finishReason, textLength: result.text.trim().length, usage: result.usage }))
    if (maxTokens === 1024) { expect(result.finishReason).toBe('stop'); expect(result.text.trim().length).toBeGreaterThan(0) }
  }
  expect((await checkReviewConfiguration({ ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS, generation: {
    providerId: process.env.BLUEPRINT_MODEL_PROBE_PROVIDER!, modelId: process.env.BLUEPRINT_MODEL_PROBE_MODEL!,
  } })).generation.status).toBe('ready')
}, 90000)
