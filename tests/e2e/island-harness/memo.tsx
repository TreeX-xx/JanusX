import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoPanel } from '../../../src/renderer/src/components/memo/MemoPanel'
import { JanusIsland } from '../../../src/renderer/src/components/janus/JanusIsland'
import type { JanusIslandStage } from '../../../src/renderer/src/components/janus/janusIslandTypes'
import { JanusChatProvider, useJanusChatRegistry } from '../../../src/renderer/src/components/janus/JanusChatProvider'
import type { UseJanusChatReturn } from '../../../src/renderer/src/components/janus/useJanusChat'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { applyMemoOperations, readMemoFile, type Memo } from '../../../src/shared/memo'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useExperimentalStore } from '../../../src/renderer/src/stores/experimental'
import { ExperimentalSettingsPanel } from '../../../src/renderer/src/components/ExperimentalSettingsPanel'
import { DEFAULT_EXPERIMENTAL_FEATURES, normalizeExperimentalFeatures } from '../../../src/shared/ipc/experimental'
import type { Workspace } from '../../../src/shared/ipc/workspace'
import type { ChatSteerInput, ChatStreamEvent, ChatStreamRequest } from '../../../src/shared/ipc/llm'
import { AuthType } from '../../../packages/llm-core/src/core/types'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/components/janus/janus-island.css'

installElectronApiFallback()
Object.assign(window.electron.subAgentRun, { list: async () => [] })
Object.assign(window.electron.workflowx, { detect: async (workspaceId: string | null) => ({ workspaceId, status: 'unconfigured', sources: [], checkedAt: Date.now() }) })
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
const params = new URLSearchParams(window.location.search)
const withSettings = params.has('settings')
if (withSettings) {
  let features = { ...DEFAULT_EXPERIMENTAL_FEATURES }
  window.electron.experimental = {
    get: async () => ({ ...features }),
    update: async partial => { features = normalizeExperimentalFeatures({ ...features, ...partial }); return { ...features } },
  }
}
if (params.has('roundtable')) useExperimentalStore.setState({ roundtable: true })
const integratedIsland = params.has('island')
const preview = params.has('preview')
const withWorkspaces = params.has('workspaces') || preview
const workspaces: Workspace[] = withWorkspaces ? ['JanusX', 'AgentX'].map((name, index) => ({
  id: `workspace-${index + 1}`, name, path: `C:/fixture/${name}`, clis: [],
  layout: { mode: 'tabs', positions: [] }, createdAt: '2026-10-14', updatedAt: '2026-10-14',
})) : []
useWorkspaceStore.setState({ workspaces })
const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const initial: Memo[] = ['A', 'B'].map((title, index) => ({ version: 3, id: fixtureId(index + 1), title, revision: 0, createdAt: 1, updatedAt: 1, nodes: [] }))
if (preview) {
  initial[0].title = 'JanusX · 布局优化'
  initial[0].updatedAt = Date.now()
  initial[0].nodes = [
    { id: fixtureId(10), title: '双岛协作布局', label: '第一版 · 10 / 13', points: [
      { id: fixtureId(20), text: '让备忘录与对话共享可用空间。打开左侧备忘录时，主体自动让出位置，两个岛作为整体居中。' },
      { id: fixtureId(21), text: '缩小窗口时先收起文件栏，保持记录正文可读；继续缩小时切换排列方式。' },
    ] },
    { id: fixtureId(11), title: '下一步体验确认', label: '待确认', points: [
      { id: fixtureId(22), text: '试试缩放窗口、编辑记录、展开文件栏。切换布局不会退出当前备忘录或打断回复。' },
    ] },
  ]
  initial[1].title = '灵感与待办'
}
const storageKey = preview ? 'memo-preview-files' : 'memo-fixture-files'
let memos: Memo[] = JSON.parse(localStorage.getItem(storageKey) ?? JSON.stringify(initial)).map(readMemoFile)
const changes = new Set<(change: { id: string; revision: number | null }) => void>()
const delta = new Set<(event: ChatStreamEvent) => void>()
const done = new Set<(event: ChatStreamEvent) => void>()
const requests: ChatStreamRequest[] = []
const steers: ChatSteerInput[] = []
let aborted = 0
let selectedController: UseJanusChatReturn
function notify(id: string, revision: number | null) {
  localStorage.setItem(storageKey, JSON.stringify(memos))
  for (const listener of changes) listener({ id, revision })
}
window.electron.memo = {
  list: async () => structuredClone(memos),
  create: async title => { const memo: Memo = { version: 3, id: crypto.randomUUID(), title, revision: 0, createdAt: Date.now(), updatedAt: Date.now(), nodes: [] }; memos.push(memo); notify(memo.id, 0); return structuredClone(memo) },
  edit: async (id, edit) => { const index = memos.findIndex(memo => memo.id === id); const memo = applyMemoOperations(memos[index], edit, () => crypto.randomUUID()); memos[index] = memo; notify(id, memo.revision); return structuredClone(memo) },
  remove: async (id, revision) => { if (memos.find(memo => memo.id === id)!.revision !== revision) throw new Error('MEMO_CONFLICT'); memos = memos.filter(memo => memo.id !== id); notify(id, null) },
  onChanged: callback => { changes.add(callback); return () => { changes.delete(callback) } },
}
Object.assign(window.electron.llm, {
  getTerminalProviders: async () => [{ id: 'fixture', name: 'Fixture', authType: AuthType.NONE }],
  getTerminalDefault: async () => ({ provider: { id: 'fixture', name: 'Fixture', authType: AuthType.NONE }, modelId: 'fixture-model' }),
  listModels: async () => [],
  startChatStream: (request: ChatStreamRequest) => { requests.push(request); delta.forEach(listener => listener({ requestId: request.requestId, delta: `Reply ${requests.length}` })) },
  steerChat: async (input: ChatSteerInput) => { steers.push(input); return { accepted: true } },
  abortChat: async () => { aborted++ },
  onDelta: (callback: (event: ChatStreamEvent) => void) => { delta.add(callback); return () => delta.delete(callback) },
  onDone: (callback: (event: ChatStreamEvent) => void) => { done.add(callback); return () => done.delete(callback) },
})
window.electron.janusChat = {
  load: async () => ({ version: 1, activeConversationId: 'memo-chat', conversations: [{ id: 'memo-chat', title: 'Memo chat', createdAt: 1, updatedAt: 1, messages: preview ? [
    { id: 'preview-user', role: 'user', timestamp: Date.now() - 60000, content: '我希望备忘录打开时，主体 island 能主动调整位置。窗口缩小也不要截断记录内容。' },
    { id: 'preview-assistant', role: 'assistant', timestamp: Date.now(), content: '已整理为第一版布局：\n\n- 两个岛并排，作为整体居中。\n- 空间变小时先收起文件栏。\n- 高度足够时上下排列；宽高都不足时切换对话与备忘录。\n\n左侧可以继续记录节点和想法。' },
  ] : [], attachedWorkspaceIds: preview ? [workspaces[0].id] : [], toolTraces: [] }] }),
  save: async () => undefined,
}
const fixture = {
  requests, steers, get memos() { return memos }, get aborted() { return aborted },
  get messages() { return selectedController.messages },
  /** Session list with each session's memo, so a memo switch is observable. */
  get sessions() { return selectedController.conversations },
  get activeId() { return selectedController.conversationId },
  bind: (memoId: string | null) => selectedController.bindMemo(memoId),
  send: (text: string) => selectedController.send(text),
  finish: () => { const request = requests.at(-1)!; done.forEach(listener => listener({ requestId: request.requestId, done: true })) },
  modelUpdate: (id: string, title: string) => { const index = memos.findIndex(memo => memo.id === id); memos[index] = applyMemoOperations(memos[index], { expectedRevision: memos[index].revision, operations: [{ op: 'rename', title }] }, () => crypto.randomUUID()); notify(id, memos[index].revision) },
}
;(window as unknown as { memoFixture: typeof fixture }).memoFixture = fixture
/** ?scaled=1 simulates a scaled main interface surface plus the chrome and
 *  command-dropdown tiers that used to cover the memo panel. */
const scaledMain = params.has('scaled')
function Harness() {
  // Follow the active session: switching memos ends one session and opens another.
  const controller = useJanusChatRegistry().getController()
  selectedController = controller
  const [stage, setStage] = useState<JanusIslandStage>('expanded')
  const previewOpened = React.useRef(false)
  const settings = withSettings ? <aside data-testid="experimental-settings" style={{ position: 'fixed', left: 0, top: 0, width: 430, maxHeight: '100vh', overflow: 'auto', zIndex: 11000, background: 'var(--shell-canvas)' }}><ExperimentalSettingsPanel /></aside> : null
  useEffect(() => {
    if (!preview || !integratedIsland || controller.conversationId !== 'memo-chat' || previewOpened.current) return
    previewOpened.current = true
    document.querySelector<HTMLElement>('.janus-expanded-view-button[data-view="chat"]')?.click()
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.janus-chat-view .memo-trigger')?.click()
      controller.bindMemo(initial[0].id)
    })
    return () => cancelAnimationFrame(frame)
  }, [controller.conversationId])
  if (integratedIsland) return <>
    {settings}
    <div className="janus-island-cluster" style={{ zIndex: 9999 }}>
      <JanusIsland stage={stage} onSingleActivate={() => setStage('expanded')} onDoubleActivate={() => setStage(value => value === 'expanded' ? 'collapsed' : 'expanded')} onDismiss={() => setStage('collapsed')}
        messages={controller.messages} pendingContent={controller.pendingContent} isStreaming={controller.isStreaming} error={controller.error}
        modelOptions={controller.modelOptions} activeModel={controller.activeModel} modelNotice={controller.modelNotice}
        onChatSelectModel={controller.selectModel} onChatSend={controller.send} onChatRewrite={controller.rewrite} onChatStop={controller.stop} onChatRetry={controller.retry} onChatClear={controller.clear}
        conversationController={controller} resourceController={controller.resourceController} toolTraces={controller.toolTraces} />
    </div>
    <button data-testid="reopen" hidden={stage === 'expanded'} onClick={() => setStage('expanded')} style={{ position: 'fixed', bottom: 12, right: 12 }}>Reopen</button>
  </>
  return <>
    {settings}
    {scaledMain && <>
      <div data-testid="chrome-bar" style={{ position: 'fixed', left: 0, right: 0, top: 0, height: 38, zIndex: 9999, background: 'rgba(20,20,24,0.55)', backdropFilter: 'blur(20px)' }} />
      <div data-testid="dropdown-decoy" style={{ position: 'fixed', left: 120, top: 200, width: 200, height: 150, zIndex: 10050, background: '#334' }} />
    </>}
    <main className="janus-chat" style={{ position: 'fixed', left: 500, top: 60, width: 450, height: 600, border: '1px solid #333', padding: 16, transform: scaledMain ? 'translateX(32px) scale(0.85)' : undefined }} data-streaming={controller.isStreaming}>
      <MemoPanel onBindMemo={controller.bindMemo} />
      <p data-testid="reply">{controller.pendingContent}</p>
      <p data-testid="notice">{controller.modelNotice}</p>
      <button onClick={controller.stop}>Stop</button>
    </main>
  </>
}
async function boot() {
  document.documentElement.dataset.theme = params.get('theme') ?? 'dark'
  document.body.style.background = 'var(--shell-canvas)'
  document.body.style.color = 'var(--shell-text)'
  await initI18n()
  await changeLanguage(preview ? 'zh-CN' : 'en')
  createRoot(document.getElementById('root')!).render(<JanusChatProvider><Harness /></JanusChatProvider>)
}
void boot()
