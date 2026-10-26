// Note: preserve required context without treating unknown windows as 16K — see .agents/notes/blueprint/maintenance/blueprint-maintenance-approval-gap.md
import { ChatSessionRuntime, estimateContextTokens } from '@janus-agent/chat-core'
import { matchAiModel } from '@janusx/llm-core/model-registry'

interface ModelBudget { contextWindow?: number; maxOutputTokens?: number }
interface Section { label: string; content: string }
const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
// Application request ceiling, not a claim about an unknown provider's model capacity.
const UNKNOWN_MODEL_REQUEST_CEILING = 65536

/** Custom provider models often do not appear in the adapter's short common-model list. */
export function proposalModelBudget(modelId: string, listed?: ModelBudget): ModelBudget {
  if (listed && positive(listed.contextWindow)) return listed
  const match = matchAiModel(modelId)
  const known = match.confidence === 'exact' || match.confidence === 'high' ? match.match : null
  return {
    contextWindow: positive(known?.effectiveContextWindow) ? known.effectiveContextWindow : undefined,
    maxOutputTokens: listed?.maxOutputTokens ?? known?.maxOutputTokens,
  }
}

const budgetError = (error: unknown): boolean => error instanceof Error
  && /^(CURRENT|SYSTEM)_CONTEXT_EXCEEDS_BUDGET\b/.test(error.message)

/** One-shot generation must not inherit the chat session's loaded evidence or summary twice. */
export function buildProposalContext(input: {
  modelId: string; model: ModelBudget; system: string; schemaTokens: number
  required: Section[]; optional: Section[]
}): { content: string; omitted: string[] } {
  const runtime = new ChatSessionRuntime()
  const optional = input.optional.filter(section => section.content.trim())
  const render = (included: Section[], omitted: Section[]) => [
    ...input.required.map(section => `${section.label}:\n${section.content}`),
    ...included.map(section => `${section.label}:\n${section.content}`),
    ...(omitted.length ? [`Auxiliary context omitted to fit the model: ${omitted.map(section => section.label).join(', ')}. Its contents were NOT read by the model; do not infer facts or cite evidence from omitted sections. Note source and conversation above are complete as supplied.`] : []),
  ].join('\n\n')
  const model = positive(input.model.contextWindow) ? input.model
    : { ...input.model, contextWindow: UNKNOWN_MODEL_REQUEST_CEILING }
  const fit = (content: string): string => {
    const messages = runtime.buildContext([{ role: 'system', content: input.system }, { role: 'user', content }], {
      model, toolTokens: input.schemaTokens,
    })
    return messages.find(message => message.role === 'user')!.content
  }
  try { return { content: fit(render(optional, [])), omitted: [] } }
  catch (error) { if (!budgetError(error)) throw error }
  const included: Section[] = []
  let omitted = [...optional]
  let content: string
  try { content = fit(render(included, omitted)) }
  catch (error) {
    if (!budgetError(error)) throw error
    const sizes = input.required.map(section => `${section.label} ≈ ${estimateContextTokens(section.content)} tokens`).join('；')
    const limit = positive(input.model.contextWindow) ? `窗口 ${input.model.contextWindow} tokens`
      : `窗口未知；超出应用单次请求上限 ${UNKNOWN_MODEL_REQUEST_CEILING} tokens（不是模型窗口）`
    throw new Error(`整理的必要上下文仍超出预算（已排除辅助证据）。模型 ${input.modelId}，${limit}；${sizes}；另预留结构化格式 ${input.schemaTokens} tokens、输出及安全余量。请缩小 Note 范围或选择已知更大窗口的模型。`, { cause: error })
  }
  // Admission is by whole section. Never truncate Note bodies or discard older user constraints.
  for (const section of optional) {
    const remaining = omitted.filter(item => item !== section)
    try {
      content = fit(render([...included, section], remaining))
      included.push(section)
      omitted = remaining
    } catch (error) {
      if (!budgetError(error)) throw error
    }
  }
  return { content, omitted: omitted.map(section => section.label) }
}
