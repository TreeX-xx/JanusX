/**
 * @file LLM IPC Handlers
 * @description IPC 通信处理器，暴露 LLM 服务给渲染进程。
 *              流式聊天编排已下沉到 janus-agent/chat-orchestrator（audit A2），
 *              本文件只做参数解包与 handler 注册。
 */

import { ipcMain, BrowserWindow, net } from 'electron'
import { randomUUID } from 'node:crypto'
import type { UserMemoryDelivery } from '../../shared/memory-strength'
import { containsMemoryDelivery, recordUserMemoryAccessBestEffort } from '../knowledge/memory-access'
import { llmService } from '../llm/LlmService'
import type { ProviderSettings } from '@janusx/llm-core'
import { captureEngineeringUserMemory } from '../knowledge/engineering-user-memory'
import { knowledgeProcessingQueue } from '../knowledge/processing-queue'
import { capturePersonChatTurn, capturePersonEpisodeFromTurn } from '../knowledge/user-turn-capture'
import { getModelCatalogService } from '../llm/ModelCatalogService'
import { LLM_CHANNELS } from '../../shared/ipc/llm'
import type { ChatAnswerQuestionPayload, ChatWorkspaceResource, LlmRuntimeStatus } from '../../shared/ipc/llm'
import { getDevelopmentLlmSyncStatus } from '../llm/development-config-sync'
import { generateText } from '../llm/ai-runtime'
import { configurationService } from '../llm/configuration-service'
import { discoverProviderModels } from '../llm/discover-provider-models'
import { nativeLoginService, startNativeLogin, stopNativeLogin } from '../llm/native-login'
import type { AgentModelBinding, LlmConsumer } from '../../shared/llm-configuration'
import {
  abortChatStream,
  answerChatQuestion,
  cancelChatSteer,
  handleChatStream,
  prepareJanusChatRecall,
  submitChatSteer,
  type ChatMessage,
  type ChatStreamRequest,
} from '../llm/chat-orchestrator'

export { abortAllChatStreams } from '../llm/chat-orchestrator'

/** 对话请求参数 */
interface ChatRequest {
  messages: ChatMessage[]
  providerId: string
  modelId?: string
  sourceTag?: 'janus-chat' | 'launch-assistant'
  conversationId?: string
  workspaceId?: string
  workspacePath?: string
  workspaceResources?: ChatWorkspaceResource[]
  /** Contract mirror of shared ChatRequest; the non-stream path has no tool loop. */
  toolAllowlist?: string[]
}

let connectionStatus: LlmRuntimeStatus['connection'] = { state: 'checking' }

export async function refreshLlmRuntimeStatus(): Promise<LlmRuntimeStatus> {
  try {
    const configured = await llmService.getDefaultModel()
    if (!configured) {
      connectionStatus = { state: 'unconfigured', checkedAt: new Date().toISOString() }
    } else {
      const result = await llmService.testConnection(configured.provider, configured.modelId)
      connectionStatus = {
        state: result.success ? 'available' : 'unavailable',
        providerId: configured.provider.id,
        checkedAt: new Date().toISOString(),
        ...(result.latency !== undefined ? { latency: result.latency } : {}),
        ...(!result.success && result.error ? { error: result.error.slice(0, 500) } : {}),
      }
    }
  } catch (error) {
    connectionStatus = {
      state: 'unavailable',
      checkedAt: new Date().toISOString(),
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    }
  }
  return { profileSync: getDevelopmentLlmSyncStatus(), connection: { ...connectionStatus } }
}

/**
 * 注册 LLM 相关的 IPC handlers
 */
export function registerLlmHandlers(): void {
  for (const channel of [LLM_CHANNELS.getConfiguration, LLM_CHANNELS.saveProvider, LLM_CHANNELS.applyBinding, LLM_CHANNELS.getNativeLoginStatus]) {
    ipcMain.handle(channel, async (event, first: unknown, second: unknown) => {
      const authorized = BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.webContents === event.sender)
        && event.senderFrame === event.sender.mainFrame
      if (!authorized) throw new Error('Unauthorized')
      try {
        if (channel === LLM_CHANNELS.getConfiguration) return await configurationService.get()
        if (channel === LLM_CHANNELS.getNativeLoginStatus) return await nativeLoginService.getStatus(first as LlmConsumer)
        if (channel === LLM_CHANNELS.saveProvider) return await configurationService.save(first as ProviderSettings)
        await configurationService.apply(first as LlmConsumer, second as AgentModelBinding)
        return { success: true }
      } catch (error) {
        if (channel === LLM_CHANNELS.getConfiguration) throw error
        if (channel === LLM_CHANNELS.getNativeLoginStatus) return { status: 'unknown', checkedAt: new Date().toISOString() }
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }
  ipcMain.handle(LLM_CHANNELS.startNativeLogin, async (_event, consumer: LlmConsumer) => {
    const authorized = BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.webContents === _event.sender)
      && _event.senderFrame === _event.sender.mainFrame
    if (!authorized) throw new Error('Unauthorized')
    return startNativeLogin(consumer)
  })
  ipcMain.handle(LLM_CHANNELS.stopNativeLogin, async (_event, consumer: LlmConsumer) => {
    const authorized = BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && window.webContents === _event.sender)
      && _event.senderFrame === _event.sender.mainFrame
    if (!authorized) throw new Error('Unauthorized')
    stopNativeLogin(consumer)
  })
  ipcMain.handle(LLM_CHANNELS.runtimeStatus, () => refreshLlmRuntimeStatus())
  ipcMain.handle(LLM_CHANNELS.getCatalog, () => getModelCatalogService().getCatalog())
  ipcMain.handle(LLM_CHANNELS.getChatModelBudget, (_event, providerId: string, modelId: string) => llmService.getChatModelBudget(providerId, modelId))
  ipcMain.handle(LLM_CHANNELS.refreshCatalog, async () => {
    const catalogService = getModelCatalogService()

    // Refreshing the catalog uses the main-process fetch implementation. Make
    // sure proxy detection has completed before the first request, then retry
    // once after re-detecting the proxy when the request fails.
    await llmService.initialize()
    let result = await catalogService.refresh()
    if (!result.success) {
      await llmService.initialize()
      result = await catalogService.refresh()
    }
    return result
  })

  // 获取单终端的 Provider 列表
  ipcMain.handle(LLM_CHANNELS.getTerminalProviders, async (_, terminal: string) => {
    try {
      return await llmService.getTerminalProviders(terminal as 'janus' | 'claude' | 'codex' | 'opencode' | 'pi')
    } catch (error: any) {
      console.error('[IPC] llm:get-terminal-providers error:', error)
      throw error
    }
  })

  // 保存单终端的 Provider 配置
  ipcMain.handle(LLM_CHANNELS.saveTerminalProvider, async (_, terminal: string, settings: ProviderSettings) => {
    try {
      return await llmService.saveTerminalProvider(terminal as 'janus' | 'claude' | 'codex' | 'opencode' | 'pi', settings)
    } catch (error: any) {
      console.error('[IPC] llm:save-terminal-provider error:', error)
      return { success: false, error: error.message }
    }
  })

  // 测试连接
  ipcMain.handle(LLM_CHANNELS.testConnection, async (_, payload: ProviderSettings & { testModel?: string }) => {
    try {
      return await llmService.testConnection(payload, payload.testModel)
    } catch (error: any) {
      console.error('[IPC] llm:test-connection error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(LLM_CHANNELS.discoverModels, async (_, provider: ProviderSettings) => {
    return discoverProviderModels(provider, (input, init) => net.fetch(String(input), init))
  })

  // 删除单终端的 Provider
  ipcMain.handle(LLM_CHANNELS.removeTerminalProvider, async (_, terminal: string, providerId: string) => {
    try {
      await llmService.removeTerminalProvider(terminal as 'janus' | 'claude' | 'codex' | 'opencode' | 'pi', providerId)
      return { success: true }
    } catch (error: any) {
      console.error('[IPC] llm:remove-terminal-provider error:', error)
      return { success: false, error: error.message }
    }
  })

  // 设置单终端的默认 Provider
  ipcMain.handle(LLM_CHANNELS.setTerminalDefault, async (_, terminal: string, providerId: string) => {
    try {
      await llmService.setTerminalDefault(terminal as 'janus' | 'claude' | 'codex' | 'opencode' | 'pi', providerId)
      return { success: true }
    } catch (error: any) {
      console.error('[IPC] llm:set-terminal-default error:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取单终端的默认 Provider
  ipcMain.handle(LLM_CHANNELS.getTerminalDefault, async (_, terminal: string) => {
    try {
      return await llmService.getTerminalDefaultModel(terminal as 'janus' | 'claude' | 'codex' | 'opencode' | 'pi')
    } catch (error: any) {
      console.error('[IPC] llm:get-terminal-default error:', error)
      return null
    }
  })

  // 获取可用模型列表
  ipcMain.handle(LLM_CHANNELS.listModels, async (_, terminal: string, providerId: string) => {
    try {
      return await llmService.listModels(terminal as 'janus' | 'claude' | 'codex' | 'opencode' | 'pi', providerId)
    } catch (error: any) {
      console.error('[IPC] llm:list-models error:', error)
      throw error
    }
  })

  // 获取可用适配器类型
  ipcMain.handle(LLM_CHANNELS.getAdapters, async () => {
    try {
      return llmService.getAvailableAdapters()
    } catch (error: any) {
      console.error('[IPC] llm:get-adapters error:', error)
      throw error
    }
  })

  // 对话请求（非流式）
  ipcMain.handle(LLM_CHANNELS.chat, async (_, request: ChatRequest) => {
    try {
      const { messages, providerId, modelId, sourceTag, workspaceId, workspacePath, workspaceResources } = request
      const soleResource = workspaceResources?.length === 1 ? workspaceResources[0] : undefined

      const settings = await llmService.getProviderSettings('janus', providerId)
      if (!settings) {
        throw new Error(`Provider "${providerId}" 未配置`)
      }

      const actualModelId = modelId || settings.modelId || ''
      if (!actualModelId) throw new Error('No model ID configured')

      // 过滤掉空内容的消息
      let formattedMessages = messages
        .filter(m => m.content && m.content.trim().length > 0)
        .map(m => ({
          role: m.role,
          content: m.content
        }))

      let userMemoryDelivery: UserMemoryDelivery | undefined
      const recallRequestId = randomUUID()
      if (sourceTag === 'janus-chat') {
        const recalled = await prepareJanusChatRecall(
          'non-stream',
          formattedMessages,
          soleResource?.workspaceId ?? workspaceId,
          soleResource?.workspacePath ?? workspacePath,
        )
        formattedMessages = recalled.messages
        userMemoryDelivery = recalled.userMemoryDelivery
      }

      // 使用 AI SDK
      const model = await llmService.getLanguageModel('janus', providerId, actualModelId)

      const result = await generateText({
        model: model as any,
        messages: formattedMessages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content
        })),
      })

      if (userMemoryDelivery && containsMemoryDelivery(formattedMessages, userMemoryDelivery)) {
        await recordUserMemoryAccessBestEffort(userMemoryDelivery, recallRequestId)
      }

      if (sourceTag === 'janus-chat') {
        const userMessage = [...formattedMessages].reverse().find((message) => message.role === 'user')
        // User memory closeout: the person timeline grows on every janus-chat
        // turn. Workspace-attached turns keep the project observations below
        // and add one episode; workspace-free turns capture observations plus
        // the episode into person scope. Helpers fail open, never the chat.
        if (!soleResource) {
          const sessionId = request.conversationId
          await capturePersonChatTurn({
            userText: userMessage?.content,
            assistantText: result.text || '',
            sessionId,
            providerId,
            modelId: actualModelId,
          })
          return result.text || ''
        }
        // Non-stream chat has no requestId; the owning session is the attached
        // agent session, falling back to the chat conversation.
        const sessionId = soleResource.agentSessionId || request.conversationId
        if (userMessage) {
          await captureEngineeringUserMemory({
            workspaceId: soleResource.workspaceId,
            workspacePath: soleResource.workspacePath,
            source: 'janus-chat',
            type: 'conversation-turn',
            content: userMessage.content,
            summary: 'Janus Chat user message',
            tags: ['janus-chat', 'user'],
            actor: 'user',
            sessionId,
          }, { speaker: 'user' })
        }
        knowledgeProcessingQueue.scheduleImmediate(soleResource.workspaceId)
        await capturePersonEpisodeFromTurn({ userText: userMessage?.content })
      }

      return result.text || ''
    } catch (error: any) {
      console.error('[IPC] llm:chat error:', error.message)
      throw error
    }
  })

  // 流式对话请求（单向 send/on 模式，确保事件可靠送达渲染端）
  // handleChatStream 内部全量捕获异常，不会产生 unhandled rejection
  ipcMain.on(LLM_CHANNELS.chatStream, (event, request: ChatStreamRequest) => handleChatStream(event, request))

  // 中止流式请求
  ipcMain.handle(LLM_CHANNELS.abort, async (_, requestId: string) => {
    abortChatStream(requestId)
    return { success: true }
  })

  // R6-full：流式中 steering 投递与撤销（目标不存在/流已结束即拒绝，由渲染端回退）。
  ipcMain.handle(LLM_CHANNELS.steer, async (_, input: import('../../shared/ipc/llm').ChatSteerInput) => {
    return submitChatSteer(input ?? { entryId: '', text: '' })
  })
  ipcMain.handle(LLM_CHANNELS.steerCancel, async (_, input: { conversationId?: string; entryId: string }) => {
    return cancelChatSteer(input ?? { entryId: '' })
  })

  // 中途提问答复：唤醒被 QuestionPort 挂起的 ask_user 工具调用。
  ipcMain.handle(LLM_CHANNELS.answerQuestion, async (_, payload: ChatAnswerQuestionPayload) => {
    return answerChatQuestion(payload)
  })

}
