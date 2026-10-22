// Note: .agents/notes/desktop/browser-surface.md — shared native layout with optional browser chrome.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  ExternalLink,
  Globe,
  Loader2,
  PanelRightOpen,
  Plus,
  RotateCw,
  X,
} from 'lucide-react'
import { useBrowserStore } from '@/stores/browser'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppStore } from '@/stores/app'
import { useBrowserOcclusionStore } from '@/stores/browser-occlusion'
import { useIslandStore } from '@/stores/island'
import { useI18n } from '@/i18n/useI18n'
import { HoldToConfirm } from '@/components/ui/HoldToConfirm'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'
import { isBrowserStartPageUrl } from '../../../../shared/browser-url'
import {
  activateBrowserTab,
  closeBrowserTab,
  getBrowserHiddenFrame,
  getBrowserSurfaceState,
  navigateBrowserTab,
  browserTabGoBack,
  browserTabGoForward,
  openBrowserTab,
  reloadBrowserTab,
  setBrowserSurfaceBounds,
} from '@/services/browser'
import styles from './BrowserSurface.module.css'

const ZERO_BOUNDS = { x: 0, y: 0, width: 0, height: 0 }

function BrowserAction({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <ThemedTooltip label={label}>
    <button type="button" {...props} className={styles.iconBtn} aria-label={label}>{children}</button>
  </ThemedTooltip>
}

interface BrowserSurfaceProps {
  surfaceId: string
  carrier: 'pane' | 'window'
  /*-- pane 中非活动 tab 为 false：原生视图归零隐藏，组件保持挂载保活 --*/
  visible: boolean
  onRequestPopOut?: () => void
  onRequestEmbed?: () => void
  /** A bundled service page keeps login in its guest, with no Agent controls. */
  serviceUrl?: string
  /** Service views can supply their own toolbar while retaining native guest lifecycle. */
  showChrome?: boolean
}

/**
 * 双载体共用的浏览器 UI：tab 条 + 导航 + 地址栏 + bounds 上报占位层。
 * 网页本体是主进程持有的 WebContentsView；空白标签由宿主起始页呈现。
 */
export function BrowserSurface({ surfaceId, carrier, visible, onRequestPopOut, onRequestEmbed, serviceUrl, showChrome = true }: BrowserSurfaceProps) {
  const { t } = useI18n('common')
  const surface = useBrowserStore((s) => s.surfaces[surfaceId])
  /*-- tab 拖拽期间隐藏原生视图：WebContentsView 盖在 DOM 之上会吞掉 dragover，落点区只有先让位才能命中 --*/
  const tabDragInFlight = useWorkspaceStore((s) => s.tabDragInFlight)
  const dialogOpen = useBrowserOcclusionStore((s) => s.count > 0)
  const workbenchCovered = useAppStore((s) => s.activeWorkbench !== null)
  const islandCovered = useIslandStore(s => s.stage !== 'collapsed')
  const [missing, setMissing] = useState(false)
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null)
  const [addressDraft, setAddressDraft] = useState('')
  const [addressFocused, setAddressFocused] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const addressTabRef = useRef<string | undefined>(undefined)
  const frameRef = useRef(0)

  const activeTab = useMemo(
    () => surface?.tabs.find((tab) => tab.tabId === surface.activeTabId) ?? null,
    [surface],
  )
  const showStartPage = showChrome && !serviceUrl && (!activeTab || isBrowserStartPageUrl(activeTab.url))
  const effectiveVisible = visible && !tabDragInFlight && !dialogOpen && !showStartPage
    && !(carrier === 'pane' && (workbenchCovered || islandCovered)) && !activeTab?.loadError

  /*-- 挂载时拉取一次最新状态：独立窗口首载、工作区切换回挂都靠它对齐 --*/
  useEffect(() => {
    let disposed = false
    void getBrowserSurfaceState(surfaceId).then((state) => {
      if (disposed) return
      if (state) useBrowserStore.getState().applySurfaceState(state)
      else setMissing(true)
    })
    return () => {
      disposed = true
    }
  }, [surfaceId])

  /*-- bounds 上报：ResizeObserver + window resize，rAF 节流；不可见则归零隐藏原生视图 --*/
  useLayoutEffect(() => {
    const node = bodyRef.current
    if (!node) return

    // Hide immediately; waiting for rAF leaves a native view over the new dialog.
    if (!effectiveVisible) void setBrowserSurfaceBounds(surfaceId, ZERO_BOUNDS)

    const report = (): void => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        if (!effectiveVisible) {
          void setBrowserSurfaceBounds(surfaceId, ZERO_BOUNDS)
          return
        }
        const rect = node.getBoundingClientRect()
        void setBrowserSurfaceBounds(surfaceId, {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
      })
    }

    const observer = new ResizeObserver(report)
    observer.observe(node)
    window.addEventListener('resize', report)
    window.addEventListener('scroll', report, true)
    document.addEventListener('transitionend', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      window.removeEventListener('scroll', report, true)
      document.removeEventListener('transitionend', report)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      /*-- 卸载隐藏：仅 pane 宿主组件且 store 载体仍为 pane（工作区切换等）时归零；
          独立窗口卸载（含 embed 后关窗）与已 popOut 的视图都不能动 --*/
      if (carrier === 'pane' && useBrowserStore.getState().surfaces[surfaceId]?.carrier === 'pane') {
        void setBrowserSurfaceBounds(surfaceId, ZERO_BOUNDS)
      }
    }
  }, [surfaceId, effectiveVisible, carrier, activeTab?.tabId])

  /*-- 让位瞬间以冻结帧顶替原生视图：DOM 叠层（工具菜单、对话框）压住网页时，
      空场不再是一整块黑屏，而是页面的最后一帧。回到可见后丢弃。 --*/
  useEffect(() => {
    if (effectiveVisible) {
      setFrozenFrame(null)
      return
    }
    let disposed = false
    void getBrowserHiddenFrame(surfaceId).then((frame) => {
      if (!disposed && frame) setFrozenFrame(frame)
    })
    return () => {
      disposed = true
    }
  }, [surfaceId, effectiveVisible])

  /*-- 地址栏草稿：未聚焦时跟随活动 tab 的 URL --*/
  useEffect(() => {
    if (!addressFocused || addressTabRef.current !== activeTab?.tabId) {
      setAddressDraft(isBrowserStartPageUrl(activeTab?.url) ? '' : activeTab?.url ?? '')
    }
    addressTabRef.current = activeTab?.tabId
  }, [activeTab?.tabId, activeTab?.url, addressFocused])

  const submitAddress = useCallback(() => {
    const url = addressDraft.trim()
    if (!url) return
    if (activeTab) void navigateBrowserTab(surfaceId, activeTab.tabId, url)
    else void openBrowserTab(surfaceId, url)
  }, [addressDraft, activeTab, surfaceId])

  if (missing) {
    return <div className={styles.missing}>{t('common:browser.surfaceClosed')}</div>
  }

  const isEmpty = !surface || surface.tabs.length === 0

  return (
    <div className={styles.shell} data-carrier={carrier} data-browser-surface={surfaceId}>
      {showChrome && <div className={styles.header}>
        <div className={styles.tabRow}>
          <div className={styles.tabs} role="tablist" aria-label={t('common:browser.tabsAria')}>
            {surface?.tabs.map((tab) => {
              const isActive = tab.tabId === surface.activeTabId
              const title = isBrowserStartPageUrl(tab.url) ? t('common:browser.newTab') : tab.title || tab.url
              return (
                <div key={tab.tabId} className={styles.tabItem} data-active={isActive} data-browser-tab={tab.tabId}>
                  <button type="button" role="tab" aria-selected={isActive}
                    className={styles.tab} title={title}
                    onClick={() => void activateBrowserTab(surfaceId, tab.tabId)}>
                    {tab.isLoading ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : <Globe size={13} aria-hidden="true" />}
                    <span className={styles.tabTitle}>{title}</span>
                  </button>
                  <HoldToConfirm label={t('common:browser.closeTab')} className={styles.tabClose}
                    onConfirm={() => void closeBrowserTab(surfaceId, tab.tabId)}>
                    <X size={12} aria-hidden="true" />
                  </HoldToConfirm>
                </div>
              )
            })}
          </div>
          {!serviceUrl && <BrowserAction label={t('common:browser.openNewTab')}
            onClick={() => void openBrowserTab(surfaceId)}><Plus size={15} aria-hidden="true" /></BrowserAction>}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.navigation}>
            <BrowserAction label={t('common:browser.back')} disabled={!activeTab?.canGoBack}
              onClick={() => activeTab && void browserTabGoBack(surfaceId, activeTab.tabId)}>
              <ArrowLeft size={15} aria-hidden="true" />
            </BrowserAction>
            <BrowserAction label={t('common:browser.forward')} disabled={!activeTab?.canGoForward}
              onClick={() => activeTab && void browserTabGoForward(surfaceId, activeTab.tabId)}>
              <ArrowRight size={15} aria-hidden="true" />
            </BrowserAction>
            <BrowserAction label={t('common:browser.reload')} disabled={!activeTab || showStartPage}
              onClick={() => activeTab && void reloadBrowserTab(surfaceId, activeTab.tabId)}>
              {activeTab?.isLoading ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <RotateCw size={14} aria-hidden="true" />}
            </BrowserAction>
          </div>

          <form className={styles.addressField} onSubmit={(event) => { event.preventDefault(); submitAddress() }}>
            <Globe size={13} className={styles.addressIcon} aria-hidden="true" />
            <input ref={addressRef} className={styles.address} value={addressDraft}
              placeholder={t('common:browser.addressPlaceholder')} aria-label={t('common:browser.addressAria')}
              spellCheck={false} autoComplete="off" autoCapitalize="off" readOnly={Boolean(serviceUrl)}
              onChange={(event) => setAddressDraft(event.target.value)}
              onFocus={() => setAddressFocused(true)} onBlur={() => setAddressFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setAddressDraft(isBrowserStartPageUrl(activeTab?.url) ? '' : activeTab?.url ?? '')
                  event.currentTarget.blur()
                }
              }} />
            {!serviceUrl && <BrowserAction type="submit" label={t('common:browser.openAddress')}
              disabled={!addressDraft.trim()}><ArrowRight size={14} aria-hidden="true" /></BrowserAction>}
          </form>

          {!serviceUrl && surface?.agentControlled && <span className={styles.agentStatus}
            role="status" aria-label={t('common:browser.agentActive')} title={t('common:browser.agentActive')}>Agent</span>}
          {carrier === 'pane' && onRequestPopOut && <BrowserAction label={t('common:browser.popOut')}
            onClick={onRequestPopOut}><ExternalLink size={14} aria-hidden="true" /></BrowserAction>}
          {carrier === 'window' && onRequestEmbed && <BrowserAction label={t('common:browser.embedToMain')}
            onClick={onRequestEmbed}><PanelRightOpen size={14} aria-hidden="true" /></BrowserAction>}
        </div>
      </div>}

      <div ref={bodyRef} className={styles.body}>
        {/*-- 冻结帧只补"本该显示网页"的空场：起始页 / 无 tab / 加载失败各有自己的 DOM，不盖 --*/}
        {!effectiveVisible && frozenFrame && !showStartPage && !isEmpty && !activeTab?.loadError && (
          <img className={styles.frozen} src={frozenFrame} alt="" data-browser-frozen="true" />
        )}
        {showStartPage && <div className={styles.empty} data-browser-start-page="true">
          <Globe size={32} strokeWidth={1.2} className={styles.emptyIcon} aria-hidden="true" />
          <h2>{t('common:browser.startTitle')}</h2>
          <p>{t('common:browser.startHint')}</p>
          <button type="button" className={styles.primaryAction} onClick={() => { addressRef.current?.focus(); addressRef.current?.select() }}>
            {t('common:browser.enterAddress')}<ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>}
        {isEmpty && !showStartPage && <div className={styles.empty}>
          <Globe size={28} strokeWidth={1.2} className={styles.emptyIcon} aria-hidden="true" />
          <p>{t('common:browser.noTabs')}</p>
          <button type="button" className={styles.primaryAction} onClick={() => void openBrowserTab(surfaceId, serviceUrl)}>
            {serviceUrl ? t('common:cpa.openManagement') : t('common:browser.openNewTab')}
          </button>
        </div>}
        {!isEmpty && activeTab?.loadError && <div className={styles.loadError} role="alert">
          <CircleAlert size={28} strokeWidth={1.3} className={styles.emptyIcon} aria-hidden="true" />
          <h2>{t('common:browser.loadFailed')}</h2>
          <span className={styles.loadErrorUrl}>{activeTab.url}</span>
          <span className={styles.loadErrorText}>{activeTab.loadError}</span>
          <button type="button" className={styles.primaryAction} onClick={() => void reloadBrowserTab(surfaceId, activeTab.tabId)}>
            <RotateCw size={13} aria-hidden="true" />{t('common:browser.retry')}
          </button>
        </div>}
      </div>
    </div>
  )
}
