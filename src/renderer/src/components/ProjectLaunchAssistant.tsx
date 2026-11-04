// Note: 助手卡顶栏与输入框吃蓝图右栏的对话卡语言（光点 Janus 头 + opencode 方框 composer） — see .agents/notes/workbench/right-chat-column-card-language.md
// Note: config edits flow through launch-config.* + config_change; action-dispatch props retired (run/test/stop live on the window toolbar) — see .agents/notes/agent/run-config-assistant-edit-tools.md
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUp, LoaderCircle, Square } from 'lucide-react'
import type { LaunchConfig } from '@/types/project'
import type { ChatToolTraceEntry, ChatWorkspaceResource } from '../../../shared/ipc/llm'
import type { LaunchConfigChange } from '../../../shared/launch-config-chat'
import type { RunningProjectSummary } from '../../../shared/ipc/project'
import {
  streamWorkspaceLaunchAssistant,
  type WorkspaceLaunchAnalysis,
} from '@/services/workspace-launch-assistant'
import { useStreamingPrinter } from '@/hooks/useStreamingPrinter'
import { MarkdownContent } from './chat/ChatContent'
import { ChatTimeline } from './janus/ChatTimeline'
import { WorkDisclosureScope } from './chat/WorkDisclosure'
import { emptyChatTimeline, settleChatTimeline } from '../../../shared/chat-timeline'
import { normalizeLaunchAssistantHistory, serializeLaunchAssistantHistory, type LaunchAssistantMessage as Message } from '../../../shared/launch-assistant-history'
import { formatThinkingDuration } from './janus/janusReasoning'
import { useI18n } from '@/i18n/useI18n'
import styles from './ProjectSettings.module.css'

interface ProjectLaunchAssistantProps {
  analysis: WorkspaceLaunchAnalysis | null
  config: LaunchConfig | null
  projectPath: string
  workspaceResources: ChatWorkspaceResource[]
  busy: boolean
  runningProjects: RunningProjectSummary[]
  /** 浮岛卡索引等装饰变量（见 ProjectSettings 三栏错峰入场）。 */
  style?: CSSProperties
  onAnalyze: () => Promise<WorkspaceLaunchAnalysis | null>
  onConfig: (config: LaunchConfig, applied?: boolean) => void
}

export function ProjectLaunchAssistant(props: ProjectLaunchAssistantProps) {
  const historyKey = `janus-launch-history:${JSON.stringify([props.workspaceResources.map(resource => resource.workspacePath).sort(), props.projectPath])}`
  return <ProjectLaunchAssistantSession key={historyKey} {...props} historyKey={historyKey} />
}

function ProjectLaunchAssistantSession({
  analysis, config, projectPath, workspaceResources, busy, runningProjects, style, onAnalyze, onConfig,
  historyKey,
}: ProjectLaunchAssistantProps & { historyKey: string }) {
  const { t } = useI18n('editor')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const restored = normalizeLaunchAssistantHistory(JSON.parse(localStorage.getItem(historyKey) ?? 'null'))
      if (restored.length) return restored
    } catch { /* Unavailable storage or old data starts a fresh dialog. */ }
    return [{
      role: 'assistant',
      content: t('editor:launcher.greeting'),
    }]
  })
  const abortRef = useRef<(() => void) | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const streamIdRef = useRef(0)
  const toolTracesRef = useRef<ChatToolTraceEntry[]>([])
  const latestToolsRef = useRef<ChatToolTraceEntry[]>([])
  const [timeline, setTimeline] = useState(emptyChatTimeline)
  const timelineRef = useRef(timeline)
  const turnStartRef = useRef<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const { output: pendingContent, append, complete, flush, reset } = useStreamingPrinter()

  useEffect(() => {
    try { localStorage.setItem(historyKey, serializeLaunchAssistantHistory(messages)) } catch { /* Storage quotas do not interrupt a turn. */ }
  }, [historyKey, messages])

  // 加载计时：流式期间每 250ms 刷新 elapsed。
  useEffect(() => {
    if (!streaming) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [streaming])

  useEffect(() => {
    if (atBottomRef.current) messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pendingContent, timeline])

  // 与蓝图 minimalComposer 同呼吸：从 46px 起按内容长到 150px 封顶。
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [input])

  useEffect(() => () => {
    streamIdRef.current += 1
    if (abortRef.current) {
      const snapshot = settleChatTimeline(timelineRef.current, Date.now(), true)
      const content = snapshot.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
      try { localStorage.setItem(historyKey, serializeLaunchAssistantHistory([
        ...messagesRef.current, { role: 'assistant', content, timeline: snapshot },
      ])) } catch { /* Closing a dialog must still abort when storage is unavailable. */ }
    }
    abortRef.current?.()
  }, [historyKey])

  const stop = () => {
    streamIdRef.current += 1
    abortRef.current?.()
    abortRef.current = null
    const partial = flush().trim()
    const snapshot = settleChatTimeline(timelineRef.current, Date.now(), true)
    reset()
    if (partial || snapshot.blocks.length) setMessages((current) => [...current, { role: 'assistant', content: partial, timeline: snapshot }])
    toolTracesRef.current = [...toolTracesRef.current, ...latestToolsRef.current].slice(-40)
    setStreaming(false)
    setSending(false)
  }

  const send = async () => {
    const request = input.trim()
    if (!request || sending || busy || !config) return
    setInput('')
    setMessages((current) => [...current, { role: 'user', content: request }])
    setSending(true)
    const streamId = streamIdRef.current + 1
    streamIdRef.current = streamId
    try {
      const workspaceAnalysis = analysis ?? await onAnalyze()
      if (streamIdRef.current !== streamId) return
      if (!workspaceAnalysis) throw new Error(t('editor:project.analysisIncomplete'))
      reset()
      setStreaming(true)
      timelineRef.current = emptyChatTimeline()
      setTimeline(timelineRef.current)
      latestToolsRef.current = []
      turnStartRef.current = Date.now()
      setNow(Date.now())
      const replayTraces = toolTracesRef.current
      const { abort } = streamWorkspaceLaunchAssistant({
        request,
        analysis: workspaceAnalysis,
        config,
        projectPath,
        workspaceResources,
        toolTraces: replayTraces.length ? replayTraces : undefined,
        runningProjects,
        history: messages,
        onDelta: (delta) => {
          if (streamIdRef.current === streamId) append(delta)
        },
        onTimeline: (snapshot) => {
          if (streamIdRef.current !== streamId) return
          timelineRef.current = snapshot
          setTimeline(snapshot)
        },
        onConfigChange: (change: LaunchConfigChange) => {
          if (streamIdRef.current !== streamId) return
          onConfig(change.config, change.applied)
        },
        onToolTraces: (entries) => {
          if (streamIdRef.current !== streamId) return
          latestToolsRef.current = entries
        },
        onDone: (message) => {
          if (streamIdRef.current !== streamId) return
          abortRef.current = null
          void complete().then(() => {
            if (streamIdRef.current !== streamId) return
            toolTracesRef.current = [...toolTracesRef.current, ...latestToolsRef.current].slice(-40)
            const snapshot = settleChatTimeline(timelineRef.current, Date.now())
            setMessages((current) => [...current, { role: 'assistant', content: message, timeline: snapshot }])
            reset()
            setStreaming(false)
            setSending(false)
          })
        },
        onError: (error) => {
          if (streamIdRef.current !== streamId) return
          abortRef.current = null
          const partial = flush().trim()
          const snapshot = settleChatTimeline(timelineRef.current, Date.now())
          toolTracesRef.current = [...toolTracesRef.current, ...latestToolsRef.current].slice(-40)
          reset()
          setMessages((current) => [
            ...current,
            ...(partial || snapshot.blocks.length ? [{ role: 'assistant' as const, content: partial, timeline: snapshot }] : []),
            { role: 'assistant', content: error },
          ])
          setStreaming(false)
          setSending(false)
        },
      })
      abortRef.current = abort
    } catch (error) {
      if (streamIdRef.current !== streamId) return
      setMessages((current) => [...current, {
        role: 'assistant',
        content: error instanceof Error ? error.message : t('editor:launcher.requestFailed'),
      }])
      setSending(false)
    }
  }

  const elapsed = streaming && typeof turnStartRef.current === 'number'
    ? formatThinkingDuration(Math.max(0, now - turnStartRef.current))
    : null
  const workspaceNames = new Map(workspaceResources.map((resource) => [resource.workspaceId, resource.workspaceName]))

  return (
    <WorkDisclosureScope scopeKey={historyKey}>
    <aside className={styles.assistant} style={style} aria-label="Janus workspace launch assistant">
      <div className={styles.assistantHeader}>
        <div className={styles.assistantIdentity}>
          <span className={styles.assistantDot} aria-hidden="true" />
          <strong>Janus</strong>
        </div>
        <span className={styles.assistantStatus}>{analysis ? t('editor:launcher.workspaceRead') : t('editor:launcher.waitingAnalysis')}</span>
      </div>
      <div className={styles.messages} onScroll={event => {
        const element = event.currentTarget
        atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}>
        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            {message.role === 'assistant' ? message.timeline?.blocks.length
              ? <ChatTimeline snapshot={message.timeline} workspaceNames={workspaceNames} />
              : <MarkdownContent content={message.content} /> : message.content}
          </div>
        ))}
        {(streaming || pendingContent) && (
          <div className={`${styles.assistantMessage} ${styles.streamingMessage}`}>
            <div className={styles.turnStatus}>
              {!pendingContent && <LoaderCircle size={11} className={styles.spinIcon} />}
              {elapsed && <span className={styles.turnElapsed} data-turn-elapsed>{elapsed}</span>}
            </div>
            <ChatTimeline snapshot={timeline} streaming={streaming} workspaceNames={workspaceNames} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className={styles.promptBox}>
        <div className={styles.promptRow}>
          <span className={styles.promptPrefix} aria-hidden="true">›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={t('editor:launcher.inputPlaceholder')}
            rows={1}
            disabled={sending || busy}
          />
          <button
            className={styles.sendButton}
            data-mode={streaming ? 'stop' : 'send'}
            onClick={() => streaming ? stop() : void send()}
            disabled={!streaming && (!input.trim() || sending || busy)}
            title={streaming ? t('editor:launcher.stopGeneration') : t('editor:launcher.send')}
          >
            {streaming
              ? <Square size={11} fill="currentColor" />
              : sending
                ? <LoaderCircle size={14} className={styles.spinIcon} />
                : <ArrowUp size={14} />}
          </button>
        </div>
      </div>
    </aside>
    </WorkDisclosureScope>
  )
}

export default ProjectLaunchAssistant
