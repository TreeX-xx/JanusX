import { ipcMain } from 'electron'
import { JANUS_CHAT_CHANNELS, type JanusChatStorageSnapshot } from '../../shared/ipc/janus-chat'
import { janusChatStore } from '../janus/chat-store'
import { parseTopicRoute, TOPIC_ROUTE_SYSTEM, type TopicRouteRequest } from '../../shared/conversation-topics'
import { llmService } from '../llm/LlmService'
import { generateText } from '../llm/ai-runtime'

// Keep both the subject and the latest conclusion when a reply exceeds the routing budget.
const routeExcerpt = (text: string) => text.length <= 2400 ? text : text.slice(0, 800) + '\n…\n' + text.slice(-1600)

export function registerJanusChatHandlers(): void {
  ipcMain.handle(JANUS_CHAT_CHANNELS.routeTopic, async (_, request: TopicRouteRequest) => {
    if (!request || typeof request.text !== 'string' || request.text.length > 100_000
      || !Array.isArray(request.candidates) || request.candidates.length > 100
      || (request.context !== undefined && !Array.isArray(request.context))
      || request.candidates.some(c => !c || typeof c.id !== 'string' || typeof c.title !== 'string' || !Array.isArray(c.messages))) throw new Error('Invalid topic routing request')
    const fallback = await llmService.getDefaultModel()
    const providerId = request.providerId || fallback?.provider.id
    const modelId = request.modelId || fallback?.modelId
    if (!providerId || !modelId) throw new Error('No routing model configured')
    const model = await llmService.getLanguageModel('janus', providerId, modelId)
    const result = await generateText({ model, system: TOPIC_ROUTE_SYSTEM,
      prompt: JSON.stringify({ text: request.text, context: request.context?.slice(-6).map(m => ({ role: m.role, content: routeExcerpt(String(m.content)) })), candidates: request.candidates.map(c => ({ id: c.id,
        title: c.title.slice(0, 160), messages: c.messages.slice(-6).map(m => ({ role: m.role, content: routeExcerpt(String(m.content)) })) })) }),
      abortSignal: AbortSignal.timeout(30_000), maxTokens: 2048, maxRetries: 0 })
    const route = parseTopicRoute(result.text, request.candidates)
    if (!route) throw new Error(result.finishReason === 'length'
      ? '话题归属判断达到输出上限，未返回完整结果。请手动选择归属。'
      : '话题归属判断未返回有效结果，请手动选择归属。')
    return route
  })
  ipcMain.handle(JANUS_CHAT_CHANNELS.load, () => janusChatStore.load())
  ipcMain.handle(JANUS_CHAT_CHANNELS.save, async (_, snapshot: JanusChatStorageSnapshot) => {
    await janusChatStore.save(snapshot)
    return { success: true }
  })
}
