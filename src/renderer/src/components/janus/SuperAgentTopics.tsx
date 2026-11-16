import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MessageSquare, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useJanusChatRegistry } from './JanusChatProvider'
import { JanusChat } from './JanusChat'
import type { UseJanusChatReturn } from './useJanusChat'
import styles from './SuperAgentTopics.module.css'
import { MessageContextChips } from './MessageContextChips'
import { ConversationPrompt } from '../ConversationPrompt'
import { SuperAgentParallel, type ParallelView } from './SuperAgentParallel'

export function TopicTranscript({ chat, retry, latestReplyId }: { chat: UseJanusChatReturn; retry?: () => void; latestReplyId?: string }) {
  return <div className={styles.transcript}><JanusChat transcriptOnly conversationStyle visible focused={false}
    showConversationNavigation={false} showWorkspaceScope={false} showContextIndicator={false} showModelSelector={false} emptyState={false} superAgentTranscript latestReplyId={latestReplyId}
    modeColor="var(--interaction-accent)" messages={chat.messages} pendingContent={chat.pendingContent}
    isStreaming={chat.isStreaming} error={retry ? null : chat.error} conversationController={chat} resourceController={chat.resourceController}
    toolTraces={chat.toolTraces} onSend={chat.send} onRewrite={chat.rewrite} onStop={chat.stop}
    onRetry={retry ?? chat.retry} onClear={chat.clear} /></div>
}

export function SuperAgentTopics({ rootId, workspaceId, onSupplement }: { rootId: string; workspaceId: string | null; onSupplement?(id:string):void }) {
  const registry = useJanusChatRegistry(), { t } = useTranslation('janus')
  const registryRef=useRef(registry);registryRef.current=registry
  const mergedReplies=useRef(new Map<string,Set<string>>())
  const [toolbarHost,setToolbarHost]=useState<HTMLDivElement|null>(null)
  const [layout,setLayout]=useState<{id:string;view:ParallelView}|null>(null)
  const [locating,setLocating]=useState<{id:string;version:number;after:boolean}|null>(null)
  const element=useRef<HTMLElement>(null),historyTop=useRef(0),previousView=useRef<ParallelView>('conversation')
  const updateView=useCallback((id:string,view:ParallelView)=>{
    if(view==='conversation'&&!mergedReplies.current.has(id))mergedReplies.current.set(id,new Set(registryRef.current.topicConversations.filter(c=>c.topic?.fork?.id===id).flatMap(c=>c.messages.map(m=>m.id))))
    if(previousView.current==='history'&&view!=='history')historyTop.current=element.current?.closest('.janus-chat-messages')?.scrollTop??0
    setLayout(previous=>previous?.id===id&&previous.view===view?previous:{id,view})
  },[])
  const topics = registry.topicConversations.filter(c => c.topic?.rootId === rootId && c.topic.workspaceId === workspaceId)
  const latestGroup=topics.filter(c=>c.topic?.fork).at(-1)?.topic?.fork?.id
  const groupStart=topics.findIndex(c=>c.topic?.fork?.id===latestGroup)
  const view=layout&&layout.id===latestGroup?layout.view:'conversation'
  useEffect(()=>{
    const host=element.current
    if(!host)return
    const reveal=(event:Event)=>{
      const id=(event as CustomEvent<{id:string}>).detail.id,target=event.target as Element
      const entry=[...host.querySelectorAll('[data-parallel-entry]')].at(-1)
      const after=!!entry&&!entry.contains(target)&&!!(entry.compareDocumentPosition(target)&Node.DOCUMENT_POSITION_FOLLOWING)
      setLocating(previous=>({id,version:(previous?.version??0)+1,after}))
    }
    host.addEventListener('janus:reveal-input',reveal)
    return()=>host.removeEventListener('janus:reveal-input',reveal)
  },[])
  useLayoutEffect(()=>{
    const scroller=element.current?.closest('.janus-chat-messages')
    if (scroller && previousView.current!==view) {
      scroller.scrollTop=view==='history'?historyTop.current:0
      scroller.dispatchEvent(new CustomEvent('janus:transcript-view',{detail:{view}}))
    }
    previousView.current=view
  },[view])
  const root = registry.getController(rootId)
  const streaming = root.isStreaming || topics.some(topic => registry.getController(topic.id).isStreaming)
  const latestReplyId = streaming ? '' : [root, ...topics].flatMap(chat => chat.messages).filter(message => message.role === 'assistant' && !message.id.startsWith('worker-report:'))
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.id
  const renderTopic = (c: typeof topics[number]) => {
    const topic = c.topic!, controller = registry.getController(c.id)
    const chat = topic.fork ? { ...controller, messages: controller.messages.slice(topic.fork.start) } : controller
    const branchReply=chat.messages.filter(m=>m.role==='assistant'&&!m.id.startsWith('worker-report:')).at(-1)?.id??''
    const displayedReply=topic.fork?(view==='panes'||!mergedReplies.current.get(topic.fork.id)?.has(branchReply)?branchReply:''):latestReplyId
    const waiting = topic.inputs.filter(i => !c.messages.some(m => m.id === i.message.id))
    const paused = topic.inputs.some(i => i.state === 'paused' || i.state === 'failed')
    const state = topic.state !== 'ready' ? topic.state : chat.pendingQuestions.length ? 'question'
      : paused ? 'paused' : chat.isStreaming || topic.inputs[0]?.state === 'running' ? 'running' : topic.inputs.length ? 'queued' : 'done'
    return <article key={c.id} id={'topic-' + c.id} aria-label={topic.fork?c.title:undefined} data-topic-id={c.id} data-topic-state={state} data-parallel={!!topic.fork} className={styles.card}>
      {(topic.fork || state !== 'done') && <header className={styles.header}>
        {topic.fork && <strong className={styles.branchTitle} title={c.title}>{c.title}</strong>}
        <span role="status" className={styles.state}>{t(topic.afterGroup ? 'topics.waitParallel' : `topics.${state}`)}</span>
        {(chat.isStreaming || topic.inputs.some(i => ['running', 'queued', 'steering', 'accepted'].includes(i.state))) && <button type="button" className={styles.iconButton}
          aria-label={t('topics.stop')} title={t('topics.stop')} onClick={() => registry.topics.stop(c.id)}><Square size={12} /></button>}
      </header>}
      <div className={styles.body} data-topic-body="" tabIndex={topic.fork?0:undefined}>
      {chat.messages.length + Number(chat.isStreaming) > 0 && <TopicTranscript chat={chat} latestReplyId={displayedReply} retry={() => void registry.topics.resume(c.id)} />}
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
      </div>
      {topic.fork&&onSupplement&&<footer className={styles.footer}><button type="button" data-branch-supplement={c.id} onClick={()=>onSupplement(c.id)}><MessageSquare size={13}/>{t('topics.supplement')}</button></footer>}
    </article>
  }
  const renderedGroups = new Set<string>()
  const hiddenEntry=(index:number)=>layout?.id===latestGroup && view!=='conversation' && (index>=groupStart||view!=='history')
  return <section ref={element} className={styles.topics} data-superagent-topics="" data-topics-view={view} data-single="true" aria-label={t('topics.heading')}>
    <div ref={setToolbarHost} className={styles.parallelToolbar}/>
    {root.messages.length > 0 && <div hidden={!!latestGroup&&layout?.id===latestGroup&&view==='panes'}><TopicTranscript chat={root} latestReplyId={latestReplyId} /></div>}
    {topics.map((c,index) => {
      const fork = c.topic!.fork
      if (!fork) {
        const pending=c.topic!.state!=='ready'||c.topic!.inputs.length>0||!!c.topic!.diagnostic
        return <div key={c.id} className={view==='panes'&&pending?styles.pending:undefined}
          hidden={!!latestGroup&&!!hiddenEntry(index)&&!(view==='panes'&&pending)}>{renderTopic(c)}</div>
      }
      if (renderedGroups.has(fork.id)) return null
      renderedGroups.add(fork.id)
      const group = topics.filter(other => other.topic!.fork?.id === fork.id)
      const busy=group.some(other=>registry.getController(other.id).isStreaming||other.topic!.inputs.some(i=>['running','queued','steering','accepted'].includes(i.state)))
      const attention = group.some(other => registry.getController(other.id).pendingQuestions.length>0 || other.topic!.diagnostic || other.topic!.inputs.some(i => i.state === 'paused' || i.state === 'failed'))
      const lastBranch = Math.max(...group.map(other => topics.indexOf(other)))
      const continued = topics.slice(lastBranch + 1).some(other => other.messages.length > 0)
      return <div key={fork.id} data-parallel-entry={fork.id} hidden={fork.id!==latestGroup&&!!hiddenEntry(index)}>
        <div hidden={layout?.id===fork.id&&view==='panes'}>
        {fork.request&&<TopicTranscript latestReplyId={latestReplyId} chat={{...registry.getController(c.id),messages:[fork.request],pendingContent:'',isStreaming:false,pendingTimeline:undefined,pendingQuestions:[],error:null}}/>}
        {group.filter(other => other.topic!.fork!.start > 0).map(other => {
          const chat = registry.getController(other.id)
          return <TopicTranscript key={other.id} latestReplyId={latestReplyId} chat={{ ...chat, messages: chat.messages.slice(0, other.topic!.fork!.start),
            pendingContent: '', isStreaming: false, pendingTimeline: undefined, pendingQuestions: [], error: null,
            pendingReasoning: { ...chat.pendingReasoning, text: '' } }} />
        })}
        </div>
        <SuperAgentParallel id={fork.id} active={fork.id===latestGroup} busy={busy} attention={attention} continued={continued}
          branches={group.map(other=>({id:other.id,title:other.title}))} toolbarHost={toolbarHost} onViewChange={updateView} locating={locating}>{group.map(renderTopic)}</SuperAgentParallel>
      </div>
    })}
  </section>
}
