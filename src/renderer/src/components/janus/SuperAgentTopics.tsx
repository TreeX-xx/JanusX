import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useJanusChatRegistry } from './JanusChatProvider'
import { JanusChat } from './JanusChat'
import type { UseJanusChatReturn } from './useJanusChat'
import styles from './SuperAgentTopics.module.css'
import { MessageContextChips } from './MessageContextChips'
import { ConversationPrompt } from '../ConversationPrompt'

export function TopicTranscript({ chat, retry, latestReplyId }: { chat: UseJanusChatReturn; retry?: () => void; latestReplyId?: string }) {
  return <div className={styles.transcript}><JanusChat transcriptOnly conversationStyle visible focused={false}
    showConversationNavigation={false} showWorkspaceScope={false} showContextIndicator={false} showModelSelector={false} emptyState={false} superAgentTranscript latestReplyId={latestReplyId}
    modeColor="var(--interaction-accent)" messages={chat.messages} pendingContent={chat.pendingContent}
    isStreaming={chat.isStreaming} error={retry ? null : chat.error} conversationController={chat} resourceController={chat.resourceController}
    toolTraces={chat.toolTraces} onSend={chat.send} onRewrite={chat.rewrite} onStop={chat.stop}
    onRetry={retry ?? chat.retry} onClear={chat.clear} /></div>
}

function ParallelSection({ settled, fold, children }: { settled: boolean; fold: boolean; children: ReactNode }) {
  const { t } = useTranslation('janus')
  const [expanded, setExpanded] = useState<boolean>()
  const open = expanded ?? !fold
  return <details className={styles.parallel} data-parallel-section="" data-settled={settled} open={open}>
    <summary onClick={event => { event.preventDefault(); setExpanded(!open) }}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {t(settled ? 'topics.parallelFinished' : 'topics.parallelRunning')}
    </summary><div className={styles.parallelCards}>{children}</div>
  </details>
}

export function SuperAgentTopics({ rootId, workspaceId }: { rootId: string; workspaceId: string | null }) {
  const registry = useJanusChatRegistry(), { t } = useTranslation('janus')
  const topics = registry.topicConversations.filter(c => c.topic?.rootId === rootId && c.topic.workspaceId === workspaceId)
  const root = registry.getController(rootId)
  const streaming = root.isStreaming || topics.some(topic => registry.getController(topic.id).isStreaming)
  const latestReplyId = streaming ? '' : [root, ...topics].flatMap(chat => chat.messages).filter(message => message.role === 'assistant' && !message.id.startsWith('worker-report:'))
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.id
  const renderTopic = (c: typeof topics[number]) => {
    const topic = c.topic!, controller = registry.getController(c.id)
    const chat = topic.fork ? { ...controller, messages: controller.messages.slice(topic.fork.start) } : controller
    const waiting = topic.inputs.filter(i => !c.messages.some(m => m.id === i.message.id))
    const paused = topic.inputs.some(i => i.state === 'paused' || i.state === 'failed')
    const state = topic.state !== 'ready' ? topic.state : chat.pendingQuestions.length ? 'question'
      : paused ? 'paused' : chat.isStreaming || topic.inputs[0]?.state === 'running' ? 'running' : topic.inputs.length ? 'queued' : 'done'
    return <article key={c.id} id={'topic-' + c.id} data-topic-id={c.id} data-topic-state={state} data-parallel={!!topic.fork} className={styles.card}>
      {(topic.fork || state !== 'done') && <header className={styles.header}>
        {topic.fork && <strong className={styles.branchTitle}>{c.title}</strong>}
        <span role="status" className={styles.state}>{t(topic.afterGroup ? 'topics.waitParallel' : `topics.${state}`)}</span>
        {(chat.isStreaming || topic.inputs.some(i => ['running', 'queued', 'steering', 'accepted'].includes(i.state))) && <button type="button" className={styles.iconButton}
          aria-label={t('topics.stop')} title={t('topics.stop')} onClick={() => registry.topics.stop(c.id)}><Square size={12} /></button>}
      </header>}
      {chat.messages.length + Number(chat.isStreaming) > 0 && <TopicTranscript chat={chat} latestReplyId={latestReplyId} retry={() => void registry.topics.resume(c.id)} />}
      {waiting.map(i => <div key={i.message.id} className={styles.input} data-input-id={i.message.id} data-user-message={i.message.id} data-navigation-text={i.message.context?.text ?? i.message.content}><p><ConversationPrompt text={i.message.content} /></p><MessageContextChips context={i.message.context} hideReferences />
        {topic.state === 'ready' && <small>{topic.afterGroup ? t('topics.waitParallel') : i.state === 'queued' ? t('topics.queuePosition', { position: topic.inputs.filter(input => input.state === 'queued').findIndex(input => input.message.id === i.message.id) + 1 })
          : t(['steering', 'accepted'].includes(i.state) ? 'topics.steering' : i.state === 'running' ? 'topics.running' : 'topics.paused')}</small>}
        {i.error && <small role="alert">{i.error}</small>}</div>)}
      {topic.diagnostic && <div className={styles.error} role="alert">{topic.diagnostic}</div>}
      {topic.direct && (c.messages[0]?.context?.delivery !== 'sent' || topic.diagnostic) && <div className={styles.resume}>
        <button type="button" onClick={() => void registry.topics.retryDirect(c.id)}>{t('shortcuts.retryDirect')}</button>
      </div>}
      {topic.state === 'choice' && <div className={styles.choice}>
        {!topic.diagnostic && <p>{t('topics.chooseHint')}</p>}
        <button onClick={() => void registry.topics.resolve(c.id, { kind: 'new' })}>{t('topics.new')}</button>
        {topics.filter(other => other.id !== c.id && other.topic?.state === 'ready' && other.topic.inputs.length > 0).map(other => <button key={other.id}
          onClick={() => void registry.topics.resolve(c.id, { kind: 'continue', targetId: other.id })}>{t('topics.join', { title: other.title })}</button>)}
      </div>}
      {topic.state === 'ready' && paused && <div className={styles.resume}><span>{t('topics.resumeHint')}</span><button onClick={() => void registry.topics.resume(c.id)}>{t('topics.resume')}</button></div>}
    </article>
  }
  const renderedGroups = new Set<string>()
  return <section className={styles.topics} data-single="true" aria-label={t('topics.heading')}>
    {root.messages.length > 0 && <TopicTranscript chat={root} latestReplyId={latestReplyId} />}
    {topics.map(c => {
      const fork = c.topic!.fork
      if (!fork) return renderTopic(c)
      if (renderedGroups.has(fork.id)) return null
      renderedGroups.add(fork.id)
      const group = topics.filter(other => other.topic!.fork?.id === fork.id)
      const settled = group.every(other => !registry.getController(other.id).isStreaming && !other.topic!.inputs.some(i => i.state === 'running' || i.state === 'queued'))
      const attention = group.some(other => other.topic!.inputs.some(i => i.state === 'paused' || i.state === 'failed'))
      const lastBranch = Math.max(...group.map(other => topics.indexOf(other)))
      const continued = topics.slice(lastBranch + 1).some(other => other.messages.length > 0)
      return <div key={fork.id}>
        {group.filter(other => other.topic!.fork!.start > 0).map(other => {
          const chat = registry.getController(other.id)
          return <TopicTranscript key={other.id} latestReplyId={latestReplyId} chat={{ ...chat, messages: chat.messages.slice(0, other.topic!.fork!.start),
            pendingContent: '', isStreaming: false, pendingTimeline: undefined, pendingQuestions: [], error: null,
            pendingReasoning: { ...chat.pendingReasoning, text: '' } }} />
        })}
        <ParallelSection settled={settled} fold={settled && continued && !attention}>{group.map(renderTopic)}</ParallelSection>
      </div>
    })}
  </section>
}
