import { create } from 'zustand'
import type { BrowserSurfaceState } from '../../../shared/ipc/browser'
import { useGlobalToolsStore } from '@/stores/global-tools'

interface BrowserStore {
  /*-- 按 surfaceId 跟踪主进程推送的 surface 状态 --*/
  surfaces: Record<string, BrowserSurfaceState>
  applySurfaceState: (state: BrowserSurfaceState) => void
  /*-- popOut 成功后先行更新载体，避免 pane 卸载时误将视图归零隐藏（视图已移交独立窗口） --*/
  markCarrier: (surfaceId: string, carrier: BrowserSurfaceState['carrier']) => void
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  surfaces: {},
  applySurfaceState: (state) =>
    set((s) => {
      if (state.destroyed) {
        if (!s.surfaces[state.surfaceId]) return {}
        const next = { ...s.surfaces }
        delete next[state.surfaceId]
        return { surfaces: next }
      }
      return { surfaces: { ...s.surfaces, [state.surfaceId]: state } }
    }),
  markCarrier: (surfaceId, carrier) =>
    set((s) => {
      const current = s.surfaces[surfaceId]
      if (!current) return {}
      return { surfaces: { ...s.surfaces, [surfaceId]: { ...current, carrier } } }
    }),
}))

/*-- 订阅主进程 browser 事件，窗口级一次性安装（main.tsx）；窗口生命周期即订阅生命周期 --*/
export function initBrowserEventSubscriptions(): () => void {
  const offShow = window.electron.browser.onShowRequested?.(surfaceId => useGlobalToolsStore.getState().attachBrowser(surfaceId))
  const offState = window.electron.browser.onStateChanged((state) => {
    const prev = useBrowserStore.getState().surfaces[state.surfaceId]
    useBrowserStore.getState().applySurfaceState(state)
    // Only the renderer owning the singleton may reattach it, including without a project.
    const tools = useGlobalToolsStore.getState()
    if (state.destroyed) tools.forgetBrowser(state.surfaceId)
    if (!state.destroyed && prev?.carrier === 'window' && state.carrier === 'pane') {
      if (tools.browserSurfaceId === state.surfaceId) tools.attachBrowser(state.surfaceId)
    }
  })
  const offAgentControl = window.electron.browser.onAgentControlChanged(({ surfaceId, active }) => {
    const current = useBrowserStore.getState().surfaces[surfaceId]
    if (!current) return
    useBrowserStore.getState().applySurfaceState({ ...current, agentControlled: active })
  })
  return () => {
    offShow?.()
    offState()
    offAgentControl()
  }
}
