// Note: per-terminal model detection with confidence merges — see .agents/notes/terminal/terminal-model-lifecycle.md
import type { TerminalPreset } from '@/types'
import { matchAiModel } from '@janusx/llm-core/model-registry'
import type {
  RuntimeTelemetryConfidence,
  RuntimeTelemetrySnapshot,
  RuntimeTelemetrySource,
} from '../../../shared/ipc/system'

export type { RuntimeTelemetryConfidence, RuntimeTelemetrySnapshot, RuntimeTelemetrySource }

export interface RuntimeTelemetryPatch {
  detectedModel?: string
  contextTokens?: number
  contextWindowTokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  sessionId?: string
  observedAt?: number
  source?: RuntimeTelemetrySource
  confidence?: RuntimeTelemetryConfidence
  sessionBinding?: 'exact' | 'correlated'
  compactionCount?: number
  compactionCountConfidence?: 'exact'
  modelChangedAt?: number
}

export type RuntimeTelemetryState = RuntimeTelemetryPatch & {
  preset: TerminalPreset
  telemetrySessionId?: string
  telemetrySource?: RuntimeTelemetrySource
  telemetryConfidence?: RuntimeTelemetryConfidence
  telemetryUpdatedAt?: number
  telemetrySessionBinding?: 'exact' | 'correlated'
  compactionCount?: number
  compactionCountConfidence?: 'exact'
  modelChangedAt?: number
}

export interface RuntimeTelemetryUpdate {
  detectedModel?: string
  contextTokens?: number
  contextWindowTokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  telemetrySessionId?: string
  telemetrySource?: RuntimeTelemetrySource
  telemetryConfidence?: RuntimeTelemetryConfidence
  telemetryUpdatedAt?: number
  telemetrySessionBinding?: 'exact' | 'correlated'
  compactionCount?: number
  compactionCountConfidence?: 'exact'
  modelChangedAt?: number
}

/** PTY text is used only for DSH turn status, never for numeric telemetry. */
export function extractDshTurnStatus(text: string): 'running' | 'degraded' | undefined {
  const normalized = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
  if (/turn error/i.test(normalized)) return 'degraded'
  if (/模型醒了/.test(normalized)) return 'running'
  return undefined
}

export function getEstimatedContextWindow(preset: TerminalPreset, model?: string): number | undefined {
  const registryWindow = getRegistryContextWindow(model)
  if (registryWindow !== undefined) return registryWindow

  const normalized = model?.toLowerCase() ?? ''

  if (/\[1m\]|\b1m\b/.test(normalized)) return 1_000_000
  if (normalized.includes('gemini')) return 1_000_000
  if (normalized.includes('claude') || normalized.includes('sonnet') || normalized.includes('opus') || normalized.includes('haiku')) {
    return 200_000
  }
  if (normalized.includes('gpt-5')) return 400_000
  if (normalized.includes('o3') || normalized.includes('o4')) return 200_000
  if (normalized.includes('gpt-4.1') || normalized.includes('gpt-4o')) return 128_000
  if (normalized.includes('qwen') || normalized.includes('deepseek') || normalized.includes('kimi') || normalized.includes('llama')) return 128_000

  switch (preset) {
    case 'claude':
      return 200_000
    case 'codex':
      return 200_000
    case 'opencode':
      return 128_000
    case 'janus':
      return 128_000
    case 'pi':
      return 128_000
    case 'dsh':
      return 128_000
    case 'shell':
      return undefined
  }
}

export function getRegistryContextWindow(model?: string): number | undefined {
  if (!model) return undefined

  const result = matchAiModel(model)
  if (
    result.match &&
    result.confidence !== 'low' &&
    result.confidence !== 'none'
  ) {
    return result.match.effectiveContextWindow
  }

  return undefined
}

export type ContextWindowSource = 'runtime' | 'model-registry' | 'estimated' | 'unknown'

export interface ContextWindowResolution {
  runtimeWindow?: number
  modelCapacity?: number
  effectiveWindow?: number
  effectiveSource: ContextWindowSource
}

export function resolveContextWindows(
  preset: TerminalPreset,
  model?: string,
  runtimeWindow?: number,
): ContextWindowResolution {
  const modelCapacity = getRegistryContextWindow(model)
  if (runtimeWindow !== undefined) {
    return { runtimeWindow, modelCapacity, effectiveWindow: runtimeWindow, effectiveSource: 'runtime' }
  }
  if (modelCapacity !== undefined) {
    return { modelCapacity, effectiveWindow: modelCapacity, effectiveSource: 'model-registry' }
  }
  const estimatedWindow = getEstimatedContextWindow(preset, model)
  return {
    effectiveWindow: estimatedWindow,
    effectiveSource: estimatedWindow === undefined ? 'unknown' : 'estimated',
  }
}

/** exact（hook/适配器）与 correlated（活跃度相关性）都算终端级绑定；
 *  无绑定的 history 快照在同 cwd 多终端下不可归属，一律忽略。 */
function isTerminalBound(binding: RuntimeTelemetrySnapshot['sessionBinding']): boolean {
  return binding === 'exact' || binding === 'correlated'
}

export function mergeRuntimeTelemetrySnapshot(
  current: RuntimeTelemetryState,
  telemetry: RuntimeTelemetrySnapshot
): RuntimeTelemetryUpdate {
  if (telemetry.source === 'configuration') {
    // A new unbound terminal must not retain runtime numbers restored from an older process.
    const patch: RuntimeTelemetryUpdate = {}
    for (const field of ['contextTokens', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'compactionCount', 'compactionCountConfidence', 'telemetrySessionId', 'telemetrySessionBinding', 'modelChangedAt'] as const) {
      if (current[field] !== undefined) patch[field] = undefined
    }
    if (current.detectedModel !== telemetry.detectedModel) patch.detectedModel = telemetry.detectedModel
    if (current.contextWindowTokens !== telemetry.contextWindowTokens) patch.contextWindowTokens = telemetry.contextWindowTokens
    if (Object.keys(patch).length) {
      patch.telemetrySource = 'configuration'
      patch.telemetryConfidence = 'declared'
      patch.telemetryUpdatedAt = telemetry.observedAt ?? Date.now()
    }
    return patch
  }
  if (
    telemetry.source === 'history' &&
    telemetry.sessionId &&
    !isTerminalBound(current.telemetrySessionBinding) &&
    !isTerminalBound(telemetry.sessionBinding)
  ) {
    return {}
  }
  const observedAt = telemetry.observedAt ?? Date.now()
  const source = telemetry.source ?? 'terminal-text'
  const confidence = telemetry.confidence ?? defaultConfidence(source)
  const sessionChanged = Boolean(
    isTerminalBound(telemetry.sessionBinding) &&
    telemetry.sessionId &&
    current.telemetrySessionId &&
    telemetry.sessionId !== current.telemetrySessionId
  )
  // A new model invalidates a previous model's runtime capacity. Some CLIs
  // emit turn_context before task_started, so use the registry in that gap.
  const modelChanged = Boolean(
    telemetry.modelChangedAt !== undefined &&
    telemetry.detectedModel &&
    telemetry.detectedModel !== current.detectedModel,
  )
  if (
    isTerminalBound(current.telemetrySessionBinding) &&
    telemetry.source === 'history' &&
    telemetry.sessionId !== current.telemetrySessionId && !sessionChanged
  ) {
    return {}
  }
  const isOlder = !sessionChanged && current.telemetryUpdatedAt !== undefined && observedAt < current.telemetryUpdatedAt
  const lowerConfidence = !sessionChanged && confidenceRank(confidence) < confidenceRank(current.telemetryConfidence)

  if (isOlder) return {}

  const patch: RuntimeTelemetryUpdate = {}
  const assign = <K extends keyof RuntimeTelemetryUpdate>(key: K, value: RuntimeTelemetryUpdate[K]) => {
    if (value !== undefined && value !== current[key as keyof RuntimeTelemetryState]) patch[key] = value
  }

  if (!lowerConfidence || current.detectedModel === undefined) assign('detectedModel', telemetry.detectedModel)
  if (!lowerConfidence || current.contextTokens === undefined) assign('contextTokens', telemetry.contextTokens)
  if (!lowerConfidence || current.contextWindowTokens === undefined) assign('contextWindowTokens', telemetry.contextWindowTokens)
  const cumulativeFields = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
  ] as const
  for (const field of cumulativeFields) {
    const next = telemetry[field]
    const previous = current[field]
    if (
      next !== undefined &&
      (!lowerConfidence || previous === undefined) &&
      (sessionChanged || previous === undefined || next >= previous)
    ) {
      assign(field, next)
    }
  }

  if (sessionChanged) {
    for (const field of ['contextTokens', 'contextWindowTokens', ...cumulativeFields] as const) {
      if (telemetry[field] === undefined && current[field] !== undefined) patch[field] = undefined
    }
  }
  if (modelChanged && telemetry.contextWindowTokens === undefined && current.contextWindowTokens !== undefined) {
    patch.contextWindowTokens = undefined
  }

  // A history scan may find a session in the same cwd as another terminal. Only
  // a hook/adapter assertion may bind that session to this terminal instance.
  if (telemetry.sessionBinding === 'exact' && telemetry.sessionId && telemetry.sessionId !== current.telemetrySessionId) {
    patch.telemetrySessionId = telemetry.sessionId
    patch.telemetrySessionBinding = 'exact'
  }

  if (telemetry.compactionCountConfidence === 'exact' && telemetry.compactionCount !== undefined) {
    assign('compactionCount', telemetry.compactionCount)
    assign('compactionCountConfidence', 'exact')
  }

  if (telemetry.modelChangedAt !== undefined) assign('modelChangedAt', telemetry.modelChangedAt)

  if (Object.keys(patch).length === 0) return patch
  patch.telemetrySource = source
  patch.telemetryConfidence = confidence
  patch.telemetryUpdatedAt = observedAt
  return patch
}

function defaultConfidence(source: RuntimeTelemetrySource): RuntimeTelemetryConfidence {
  if (source === 'provider-event') return 'authoritative'
  if (source === 'history') return 'derived'
  return 'estimated'
}

function confidenceRank(confidence?: RuntimeTelemetryConfidence): number {
  if (confidence === 'authoritative') return 3
  if (confidence === 'derived') return 2
  if (confidence === 'declared') return 1.5
  if (confidence === 'estimated') return 1
  return 0
}
