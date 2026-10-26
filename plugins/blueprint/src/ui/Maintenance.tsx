import { t } from './i18n'
import { blueprintText as bt } from './blueprint-text'
import { useEffect, useRef, useState } from 'react'
import type { NativeAgentProgress } from '@janusx/plugin-sdk'
import type { DiscussionState } from '../main/blueprint/discussion'
import type { BlueprintNode } from '../shared/janus/types'
import type {
  BlueprintMaintenanceTask,
  BlueprintMaintenancePreview,
  BlueprintMaintenanceAuditRecord,
  BlueprintMaintenanceUndoPrepareResult,
  BlueprintDispatchBriefResult,
} from '../shared/janus/maintenance-types'
import { call, job, plugin } from './client'
import { Draft } from './draft'
import { Markdown } from './Markdown'
import { ModelSelect, type Models } from './Settings'
import './discussion-composer.css'

export function Maintenance({
  visible,
  models,
  model,
  setModel,
  node,
  nodes,
  refresh,
  close,
}: {
  visible: boolean
  models: Models
  model: { providerId: string; modelId: string }
  setModel(value: { providerId: string; modelId: string }): void
  node?: BlueprintNode
  nodes: Record<string, BlueprintNode>
  refresh(): void
  close(): void
}) {
  const [history, setHistory] = useState<DiscussionState>(),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('')
  const [brief, setBrief] = useState<BlueprintDispatchBriefResult>()
  const [task, setTask] = useState<BlueprintMaintenanceTask>(),
    [selected, setSelected] = useState<string[]>([]),
    [deletes, setDeletes] = useState<string[]>([])
  const [preview, setPreview] = useState<BlueprintMaintenancePreview>(),
    [audits, setAudits] = useState<BlueprintMaintenanceAuditRecord[]>([])
  const [undo, setUndo] = useState<BlueprintMaintenanceUndoPrepareResult>()
  const [undoDeletes, setUndoDeletes] = useState<string[]>([])
  const [scope, setScope] = useState<'node' | 'subtree' | 'blueprint'>('node')
  const [progress, setProgress] = useState<NativeAgentProgress>(),
    [pendingQuestion, setPendingQuestion] = useState('')
  const controller = useRef<AbortController>(),
    sequence = useRef(0)
  const draft = useRef<Draft>()
  const draftBlocked = useRef(false)
  const [draftFailed, setDraftFailed] = useState(false), [otherDraft, setOtherDraft] = useState<string>()
  draft.current ??= new Draft(plugin().storage, 'blueprint-discussion-draft')
  const editMessage = (value: string) => {
    setMessage(value)
    if (draftBlocked.current) return
    void draft.current!.write(value).catch(() => {
      draftBlocked.current = true; setDraftFailed(true)
      setError(t('讨论草稿未保存，请保留当前页面后重试。'))
    })
  }
  useEffect(() => {
    const abort = new AbortController()
    void Promise.all([
      call<DiscussionState>('discussion.read', null, abort.signal),
      call<BlueprintMaintenanceTask[]>('maintenance.list', null, abort.signal),
      draft.current!.read(),
    ])
      .then(([history, tasks, stored]) => {
        if (abort.signal.aborted) return
        setHistory(history)
        setTask(tasks.find((task) => !['cancelled', 'completed'].includes(task.status)))
        if (typeof stored === 'string') setMessage(stored)
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error))
      })
    return () => {
      abort.abort()
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    setSelected(task?.changeSet?.operations.map((op) => op.operationId) ?? [])
    setDeletes([])
    setPreview(undefined)
  }, [task?.changeSet?.id])
  useEffect(() => setUndoDeletes([]), [undo?.changeSet.id])
  useEffect(() => {
    let stop: (() => void) | undefined,
      disposed = false
    void plugin()
      .native.watch((event) => {
        if (event.name !== 'maintenance.changed') return
        const changed = (event.value as unknown as { task: BlueprintMaintenanceTask }).task
        setTask((current) => (current?.id === changed.id ? changed : current))
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else stop = unsubscribe
      })
      .catch((error) => {
        if (!disposed) setError(String(error))
      })
    return () => {
      disposed = true
      stop?.()
    }
  }, [])
  const action = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(label)
    setError('')
    try {
      await work(abort.signal)
    } catch (error) {
      if (!abort.signal.aborted) setError(String(error))
    } finally {
      if (controller.current === abort) {
        controller.current = undefined
        setBusy('')
      }
    }
  }
  const activeTask = task && !['completed', 'cancelled'].includes(task.status)
  const currentScope = activeTask
    ? task.nodeScope
    : !node || scope === 'blueprint'
      ? { type: 'blueprint' as const }
      : { type: scope, nodeId: node.id }
  const scopeNode = currentScope.type === 'blueprint' ? undefined : nodes[currentScope.nodeId]
  const refs = scopeNode?.sourceUri && scopeNode.sourceHash ? [{ uri: scopeNode.sourceUri, expectedHash: scopeNode.sourceHash }] : []
  const scopeKey = JSON.stringify(currentScope)
  useEffect(() => setBrief(undefined), [history?.revision, scopeKey, scopeNode?.sourceHash])
  const send = () =>
    void action(t('正在讨论'), async (signal) => {
      if (!history || !message.trim()) return
      if (task?.changeSet) setTask(await call('maintenance.dismiss', task.id, signal))
      setProgress(undefined)
      setPendingQuestion(message)
      try {
        const next = await job<DiscussionState>(
          'discussion.run',
          { ...model, message, expectedRevision: history.revision, noteRefs: refs },
          signal,
          (state) => {
            if (!signal.aborted) setProgress(state.progress)
          },
        )
        setHistory(next)
        editMessage('')
      } finally {
        setPendingQuestion('')
        setProgress(undefined)
      }
    })
  const ensureTask = async (signal: AbortSignal) => {
      if (!history?.messages.length) throw new Error(t('请先讨论需要修改的内容'))
      let current = task
      if (!current || ['completed', 'cancelled'].includes(current.status))
        current = await call(
          'maintenance.start',
          {
            conversationId: history.id,
            goal: history.messages.filter((message) => message.role === 'user').at(-1)?.content ?? t('维护工程文档'),
            nodeScope: currentScope,
          },
          signal,
        )
      setTask(current)
      return current!
  }
  const organize = () =>
    void action(t('正在整理修改'), async (signal) => {
      const current = await ensureTask(signal)
      const proposal = await job<BlueprintMaintenanceTask>(
        'maintenance.propose',
        { ...model, taskId: current.id, conversationId: history!.id, messages: history!.messages, noteRefs: refs },
        signal,
      )
      setTask(proposal)
    })
  const dispatch = () => void action(t('正在准备实施简报'), async signal => {
    const current = await ensureTask(signal)
    setBrief(await job('maintenance.dispatch', { ...model, taskId: current.id, conversationId: history!.id, messages: history!.messages, noteRefs: refs }, signal))
  })
  const selectedKey = selected.join('|')
  useEffect(() => {
    const version = ++sequence.current,
      abort = new AbortController()
    setPreview(undefined)
    if (!task?.changeSet || !selected.length || !history) return
    const timer = setTimeout(() => {
      void call<BlueprintMaintenancePreview>(
        'maintenance.preview',
        { taskId: task.id, changeSetId: task.changeSet!.id, conversationId: history.id, operationIds: selected },
        abort.signal,
      )
        .then((value) => {
          if (sequence.current === version) setPreview(value)
        })
        .catch((error) => {
          if (!abort.signal.aborted && sequence.current === version) setError(String(error))
        })
    }, 150)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [task?.changeSet?.id, selectedKey, history?.id])
  const destructive = task?.changeSet?.operations.filter((op) => selected.includes(op.operationId) && op.type === 'delete-node') ?? []
  return (
    <section className="discussion bp-maintenance-panel" hidden={!visible}>
      <header className="bp-maintenance-panel__header">
        <div className="bp-maintenance-janus-head"><span className="bp-maintenance-janus-dot" aria-hidden="true" /><strong>Janus</strong></div>
        <button type="button" className="bp-panel-close" onClick={close} aria-label={bt('maintenance.closeConsole')}>×</button>
      </header>
      <div className="bp-maintenance-scroll">
      <div className="messages">
        {history && !history.messages.length && !pendingQuestion && <p className="bp-maintenance-greeting">{bt('maintenance.greeting')}</p>}
        {history?.messages.map((message, index) => (
          <article key={index} className={message.role}>
            <strong>{message.role === 'user' ? t('你') : 'Janus'}</strong>
            <Markdown text={message.content} />
          </article>
        ))}
        {pendingQuestion && (
          <>
            <article className="user">
              <strong>{t('你')}</strong>
              <Markdown text={pendingQuestion} />
            </article>
            <article className="assistant" aria-label={t('正在生成的回答')}>
              <strong>Janus</strong>
              <Markdown text={progress?.text ?? ''} />
              <p role="status">{progress?.phase === 'tool' ? t('正在读取：{0}', { '0': progress.tool }) : t('正在生成回答…')}</p>
            </article>
          </>
        )}
      </div>
      {brief && <section className="proposal"><h3>{t('实施简报')}</h3><pre>{brief.text}</pre>
        <button disabled={Boolean(busy)} onClick={() => void action(t('提交终端草稿'), async signal => {
          await plugin().workspace.proposeTerminal({ text: brief.text }, { signal })
        })}>{t('在宿主中审阅并派发')}</button></section>}
      <p role="status">{busy}</p>
      <p role="alert">{error}</p>
      {task?.changeSet && (
        <section className="proposal">
          <h3>{t('审核文件修改')}</h3>
          <p>{task.changeSet.reason}</p>
          {task.changeSet.operations.map((op) => (
            <label className="operation" key={op.operationId}>
              <input
                type="checkbox"
                checked={selected.includes(op.operationId)}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  setSelected(event.target.checked ? [...selected, op.operationId] : selected.filter((id) => id !== op.operationId))
                }
              />
              {op.reason}
              <small>{op.type}</small>
            </label>
          ))}
          {destructive.map((op) => (
            <label key={op.operationId}>
              <input
                type="checkbox"
                checked={deletes.includes(op.operationId)}
                onChange={(event) =>
                  setDeletes(event.target.checked ? [...deletes, op.operationId] : deletes.filter((id) => id !== op.operationId))
                }
              />
              {t('单独确认归档：')}
              {op.reason}
            </label>
          ))}
          {!preview && selected.length > 0 && <p role="status">{t('正在校验文件预览…')}</p>}
          {preview?.files.map((file) => (
            <details key={file.uri}>
              <summary>
                {file.path}
                {file.archivedInsteadOfDeleted ? t(' · 归档并保留文件') : ''}
              </summary>
              <h4>{t('修改前')}</h4>
              <pre>{file.before}</pre>
              <h4>{t('修改后')}</h4>
              <pre>{file.after}</pre>
            </details>
          ))}
          <div className="actions">
            <button
              disabled={Boolean(busy) || !preview || destructive.some((op) => !deletes.includes(op.operationId))}
              onClick={() =>
                void action(t('正在应用'), async (signal) => {
                  const result = await call<{ task: BlueprintMaintenanceTask }>(
                    'maintenance.apply',
                    {
                      taskId: task.id,
                      changeSetId: task.changeSet!.id,
                      previewId: preview!.id,
                      operationIds: selected,
                      confirmedDeleteOperationIds: deletes,
                    },
                    signal,
                  )
                  setTask(result.task)
                  refresh()
                })
              }
            >
              {t('确认写入已选文件')}
            </button>
            <button
              disabled={Boolean(busy)}
              onClick={() => void action(t('继续讨论'), async (signal) => setTask(await call('maintenance.dismiss', task.id, signal)))}
            >
              {t('驳回并继续讨论')}
            </button>
          </div>
        </section>
      )}
      {task && !task.changeSet && !['completed', 'cancelled'].includes(task.status) && (
        <button
          disabled={Boolean(busy)}
          onClick={() => void action(t('完成维护'), async (signal) => setTask(await call('maintenance.complete', task.id, signal)))}
        >
          {t('结束本轮维护')}
        </button>
      )}
      <details hidden={!history?.messages.length && !task && !audits.length}
        onToggle={(event) => {
          if (event.currentTarget.open)
            void call<BlueprintMaintenanceAuditRecord[]>('maintenance.audits')
              .then(setAudits)
              .catch((error) => setError(String(error)))
        }}
      >
        <summary>{t('已应用记录与撤销')}</summary>
        {activeTask && <p>{t('请先结束本轮维护，再撤销已应用记录。')}</p>}
        {audits
          .filter((audit) => audit.status === 'applied')
          .map((audit) => (
            <div key={audit.id}>
              <p>{audit.changeSetSnapshot.reason}</p>
              <button
                disabled={Boolean(busy) || Boolean(activeTask)}
                onClick={() =>
                  void action(t('准备撤销'), async (signal) => setUndo(await call('maintenance.undo-prepare', audit.id, signal)))
                }
              >
                {t('查看撤销操作')}
              </button>
            </div>
          ))}
        {undo && (
          <section>
            <h3>{t('确认撤销')}</h3>
            {undo.conflicts.map((text) => (
              <p role="alert" key={text}>
                {text}
              </p>
            ))}
            {undo.changeSet.operations.map((op) => (
              <p key={op.operationId}>{op.reason}</p>
            ))}
            {undo.changeSet.operations
              .filter((op) => op.type === 'delete-node')
              .map((op) => (
                <label key={op.operationId}>
                  <input
                    type="checkbox"
                    checked={undoDeletes.includes(op.operationId)}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      setUndoDeletes(
                        event.target.checked ? [...undoDeletes, op.operationId] : undoDeletes.filter((id) => id !== op.operationId),
                      )
                    }
                  />
                  {t('确认归档本次新增的文档：')}
                  {op.reason}
                </label>
              ))}
            <button
              disabled={
                Boolean(busy) ||
                undo.conflicts.length > 0 ||
                undo.changeSet.operations.some((op) => op.type === 'delete-node' && !undoDeletes.includes(op.operationId))
              }
              onClick={() =>
                void action(t('撤销修改'), async (signal) => {
                  await call(
                    'maintenance.undo-apply',
                    {
                      undoChangeSetId: undo.changeSet.id,
                      operationIds: undo.changeSet.operations.map((op) => op.operationId),
                      confirmedDeleteOperationIds: undoDeletes,
                    },
                    signal,
                  )
                  setUndo(undefined)
                  setAudits(await call('maintenance.audits'))
                  refresh()
                })
              }
            >
              {t('确认撤销')}
            </button>
          </section>
        )}
      </details>
      </div>
      <footer className="bp-maintenance-composer janus-chat" data-minimal-composer="true">
      <details className="bp-maintenance-controls"><summary>{t('维护范围')} · {scopeNode?.title ?? t('整个工作区')}</summary>
      <details className="bp-maintenance-models" open={!model.providerId || !model.modelId}><summary>{t('模型服务')}</summary><ModelSelect models={models} value={model} change={setModel} /></details>
      <label>
        {t('维护范围')}
        <select
          aria-label={t('维护范围')}
          value={currentScope.type}
          disabled={Boolean(busy) || Boolean(activeTask)}
          onChange={(event) => setScope(event.target.value as typeof scope)}
        >
          <option value="node" disabled={!node}>
            {t('当前 Note')}
          </option>
          <option value="subtree" disabled={!node}>
            {t('当前模块及下级')}
          </option>
          <option value="blueprint">{t('整个工作区')}</option>
        </select>
      </label>
      <p className="muted">
        {currentScope.type === 'blueprint'
          ? t('当前范围：工作区')
          : t('当前范围：{0}{1}', {
              '0': scopeNode?.title ?? t('来源已不可用'),
              '1': currentScope.type === 'subtree' ? t('及其下级') : '',
            })}
        {t('。讨论只读，文件修改先预览再确认。')}
        {activeTask ? t('本轮范围已固定，结束后可重新选择。') : ''}
      </p>
      </details>
      <div className="janus-chat-input-wrapper"><div className="janus-chat-composer-row">
      <span className="janus-chat-prompt-prefix" aria-hidden="true">›</span>
      <textarea className="janus-chat-input" rows={1}
        aria-label={t('讨论内容')}
        value={message}
        maxLength={16000}
        onChange={(event) => { editMessage(event.target.value); event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight, 150) + 'px' }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && message.trim() && model.providerId && model.modelId && history) send() } }}
        placeholder={t('描述问题、追问或提出修改目标…')}
        disabled={Boolean(busy) || !history}
      />
      {busy && <button className="janus-chat-stop" aria-label={t('停止')} title={t('停止')} onClick={() => controller.current?.abort()}>■</button>}
      <button className="janus-chat-send" aria-label={t('发送')} title={t('发送')} disabled={Boolean(busy) || !message.trim() || !model.providerId || !model.modelId || !history} onClick={send}><span aria-hidden="true">↑</span></button>
      </div></div>
      {draftFailed && <section className="proposal" aria-label={t('恢复讨论草稿')}>
        <p>{t('自动保存已暂停，当前输入仍在此页面。请比较已保存的草稿后选择。')}</p>
        <button disabled={Boolean(busy)} onClick={() => void action(t('读取已保存草稿'), async () => {
          const stored = await draft.current!.read()
          setOtherDraft(typeof stored === 'string' ? stored : '')
        })}>{t('比较已保存草稿')}</button>
        {otherDraft !== undefined && <>
          <label>{t('其它页面已保存的草稿')}<textarea readOnly value={otherDraft} /></label>
          <button disabled={Boolean(busy)} onClick={() => void action(t('保存当前输入'), async () => {
            await draft.current!.write(message)
            draftBlocked.current = false; setDraftFailed(false); setOtherDraft(undefined)
          })}>{t('保留当前输入并保存')}</button>
          <button disabled={Boolean(busy)} onClick={() => void action(t('使用已保存草稿'), async () => {
            const stored = await draft.current!.read()
            setMessage(typeof stored === 'string' ? stored : '')
            draftBlocked.current = false; setDraftFailed(false); setOtherDraft(undefined)
          })}>{t('使用已保存草稿')}</button>
        </>}
      </section>}
      <div className="actions">

        <button hidden={!history?.messages.length} disabled={Boolean(busy) || !history?.messages.length || !model.modelId} onClick={organize}>
          {t('整理修改')}
        </button>
        <button hidden={!history?.messages.length} disabled={Boolean(busy) || !history?.messages.length || !model.modelId} onClick={dispatch}>{t('准备实施简报')}</button>



        <details className="bp-maintenance-more"><summary>{bt('action.more')}</summary><div>        <button
          disabled={Boolean(busy)}
          onClick={() =>
            void action(t('重新读取讨论'), async (signal) => {
              const [next, tasks] = await Promise.all([
                call<DiscussionState>('discussion.read', null, signal),
                call<BlueprintMaintenanceTask[]>('maintenance.list', null, signal),
              ])
              setHistory(next)
              setTask(tasks.find((task) => !['cancelled', 'completed'].includes(task.status)))
            })
          }
        >
          {t('重新读取讨论（保留输入）')}
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() =>
            void action(t('清空讨论'), async (signal) => {
              if (!history) return
              if (task && !['completed', 'cancelled'].includes(task.status)) await call('maintenance.cancel', task.id, signal)
              setTask(undefined)
              setHistory(await call('discussion.clear', history.revision, signal))
            })
          }
        >
          {t('清空讨论')}
        </button></div></details>
      </div>
      </footer>
    </section>
  )
}
