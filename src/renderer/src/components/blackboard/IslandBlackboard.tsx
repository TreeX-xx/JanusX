import { useCallback, useEffect } from 'react'
import { ChevronUp, Puzzle } from 'lucide-react'
import { useAppStore, BLACKBOARD_MIN_HEIGHT, saveBlackboardHeight } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n/useI18n'
import { useExtensionViews } from '@/extensions/react'
import { BUILTIN_RIGHT_EXTENSIONS } from '@/extensions/builtins'
import { openExtensionView } from '@/extensions/workbench'
import { openPluginManager } from '@/extensions/plugin-configuration-navigation'
import './island-blackboard.css'

/* ════════════════════════════════════════════════════════════
   IslandBlackboard —— 岛下拉副黑板
   Note: .agents/notes/workbench/island-blackboard.md

   形态：中部工作区列内的上带。下拉手势把主工作区下滑让位，
   板在空出的上带里长出——不是从顶部盖下的卷帘，也不碰左右栏架。
   板面只列出已启用插件的入口；页面由各自宿主槽位打开，
   避免复制插件实例或在未安装时加载旧蓝图。
   ════════════════════════════════════════════════════════════ */

export function IslandBlackboard() {
  const { t } = useI18n(['janus', 'plugins'])
  const blackboardHeight = useAppStore((s) => s.blackboardHeight)
  const blackboardDrag = useAppStore((s) => s.blackboardDrag)
  const setBlackboardHeight = useAppStore((s) => s.setBlackboardHeight)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const views = useExtensionViews().filter(view => view.location !== 'settings'
    && !BUILTIN_RIGHT_EXTENSIONS.some(builtin => builtin.definition.id === view.extensionId))

  /*-- 拖拽预览跟手；落点/收起用 settled 高度 --*/
  const dragging = blackboardDrag !== null
  const effectiveHeight = dragging ? blackboardDrag : blackboardHeight

  const persistHeight = useCallback((height: number) => {
    saveBlackboardHeight(height)
  }, [])

  const close = useCallback(() => {
    useAppStore.getState().setBlackboardDrag(null)
    setBlackboardHeight(0)
  }, [setBlackboardHeight])

  /*-- Esc 收板：焦点在 iframe 内时 Esc 归板内页面本身 --*/
  useEffect(() => {
    if (blackboardHeight === 0 && blackboardDrag === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const active = document.activeElement
      if (active && (active.tagName === 'IFRAME' || active instanceof HTMLIFrameElement)) return
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blackboardHeight, blackboardDrag, close])

  /*-- 下缘拖高/上推收板：9px 命中区，与工作区分隔线同语言 --*/
  const onEdgePointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = blackboardHeight
    const move = (ev: PointerEvent) => {
      const next = Math.min(Math.max(startHeight + (ev.clientY - startY), 0), window.innerHeight * 0.7)
      setBlackboardHeight(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const settled = useAppStore.getState().blackboardHeight
      if (settled < BLACKBOARD_MIN_HEIGHT) {
        close()
      } else {
        persistHeight(settled)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [blackboardHeight, setBlackboardHeight, close, persistHeight])

  return (
    <section
      className="island-blackboard"
      data-dragging={dragging || undefined}
      style={{ height: effectiveHeight }}
      aria-label={t('janus:blackboard.title')}
      aria-hidden={effectiveHeight === 0}
    >
      {effectiveHeight > 0 && (
        <>
          <header className="bb-bar">
            <span className="bb-title">{t('janus:blackboard.title')}</span>
            <button type="button" className="bb-manage" onClick={() => { close(); openPluginManager() }}>
              {t('janus:blackboard.managePlugins')}
            </button>
            <button
              type="button"
              className="bb-collapse"
              onClick={close}
              title={t('janus:blackboard.close')}
              aria-label={t('janus:blackboard.close')}
            >
              <ChevronUp size={14} aria-hidden="true" />
            </button>
          </header>

          <div className="bb-slot">
            <p className="bb-hint">{t(views.length ? 'janus:blackboard.pluginHint' : 'janus:blackboard.pluginsEmpty')}</p>
            {views.length > 0 && <div className="bb-plugins">
              {views.map(view => {
                const Icon = view.icon ?? Puzzle
                const needsProject = view.scope === 'project' && !activeWorkspaceId
                return <button
                  key={view.id}
                  type="button"
                  className="bb-plugin"
                  disabled={needsProject}
                  aria-label={t('janus:blackboard.openView', { title: view.title })}
                  title={needsProject ? t('janus:blackboard.needsProject') : view.title}
                  onClick={() => { if (openExtensionView(view.id)) close() }}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{view.title}</span>
                  <span className="bb-plugin-action">{t(needsProject ? 'janus:blackboard.needsProject' : 'plugins:open')}</span>
                </button>
              })}
            </div>}
          </div>

          <div
            className="bb-edge"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('janus:blackboard.title')}
            onPointerDown={onEdgePointerDown}
          />
        </>
      )}
    </section>
  )
}
