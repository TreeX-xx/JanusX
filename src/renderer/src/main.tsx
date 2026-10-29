import { WindowControls } from './components/WindowControls'
import React, { lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { installElectronApiFallback } from './lib/electron-api-fallback'
import { initBrowserEventSubscriptions } from './stores/browser'
import { initializePluginRuntime } from './extensions/plugin-runtime'
import { PluginNotifications } from './components/plugins/PluginSettingsPanel'
import { initI18n } from './i18n'
import { useThemeStore } from './stores/theme'
import './styles/globals.css'
import './styles/themes.generated.css'
import './styles/theme-hovers.css'
import './components/viewers/markdown-preview.css'
import './components/janus/janus-island.css'

/*-- P4: 按窗口类型分包。四种窗口共用一个 HTML 入口，
     静态导入会让主窗口首屏背上编辑器/浏览器/Toast 三个用不到的根组件。 --*/
const App = lazy(() => import('./App'))
const DesktopToastApp = lazy(() =>
  import('./components/DesktopToastApp').then((m) => ({ default: m.DesktopToastApp }))
)
const StandaloneFileEditor = lazy(() =>
  import('./components/StandaloneFileEditor').then((m) => ({ default: m.StandaloneFileEditor }))
)
const StandaloneBrowser = lazy(() =>
  import('./components/browser/StandaloneBrowser').then((m) => ({ default: m.StandaloneBrowser }))
)

installElectronApiFallback()

/*-- browser 事件订阅：主窗口与独立浏览器窗口共用此入口，各窗口各自订阅一份 --*/
initBrowserEventSubscriptions()

/*-- i18n：异步初始化，语言探测 + 资源加载完成后 React 树挂载，避免首屏 fallback 闪烁 --*/
const i18nReady = initI18n()

const searchParams = new URLSearchParams(window.location.search)
const isEditorWindow = searchParams.get('editorWindow') === '1'
const isDesktopToast = searchParams.get('desktopToast') === '1'
const isBrowserWindow = searchParams.get('browserWindow') === '1'
if (!isEditorWindow && !isDesktopToast && !isBrowserWindow) void i18nReady.then(initializePluginRuntime)

/* Toast 窗口：解析出类型即同步挂透明类，不等 React effect，消灭首漆灰底 */
if (isDesktopToast) {
  document.documentElement.classList.add('toast-prepaint')
  document.body.classList.add('desktop-toast-body')
}

function EditorWindowLoading() {
  return (
    <div
      data-editor-window-state="loading"
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}
      role="status"
      aria-label="Loading editor"
    >
      <div className="titlebar-drag flex h-[38px] shrink-0 items-center px-3" style={{ borderBottom: '1px solid var(--shell-border)', background: 'var(--shell-pane-chrome)' }}>
        <span className="flex-1" />
        <WindowControls />
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 text-xs" style={{ color: 'var(--shell-dim)' }}>
        <span>Loading editor</span>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--shell-accent)' }} aria-hidden="true" />
      </div>
    </div>
  )
}

class EditorWindowErrorBoundary extends React.Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Standalone editor failed to render:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div
        data-editor-window-state="error"
        className="flex h-screen items-center justify-center px-8"
        style={{ background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}
        role="alert"
      >
        <div className="w-full max-w-md p-5" style={{ border: '1px solid var(--shell-border)', background: 'var(--shell-card)' }}>
          <div className="text-sm" style={{ color: 'var(--shell-text)' }}>Editor failed to open</div>
          <div className="mt-2 break-words font-mono text-[11px] leading-5" style={{ color: 'var(--shell-muted)' }}>
            {this.state.error.message || 'The editor renderer could not be loaded.'}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="h-8 px-3 text-xs"
              style={{ border: '1px solid var(--shell-accent-border)', background: 'var(--shell-accent-soft)', color: 'var(--shell-accent-strong)' }}
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <button
              type="button"
              className="h-8 px-3 text-xs"
              style={{ border: '1px solid var(--control-border)', color: 'var(--shell-muted)' }}
              onClick={() => window.electron.window.close()}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const rootContent = isEditorWindow ? (
  <EditorWindowErrorBoundary>
    <Suspense fallback={<EditorWindowLoading />}>
      <StandaloneFileEditor />
    </Suspense>
  </EditorWindowErrorBoundary>
) : (
  <Suspense fallback={null}>
    {isDesktopToast ? <DesktopToastApp /> : isBrowserWindow ? <StandaloneBrowser /> : <App />}
  </Suspense>
)

const renderRoot = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {rootContent}
      {!isEditorWindow && !isDesktopToast && !isBrowserWindow && <PluginNotifications />}
    </React.StrictMode>,
  )
}

// Toasts do not use translations. Mount this lightweight surface immediately
// so it can acknowledge readiness before the notification timeout expires.
if (isDesktopToast) {
  renderRoot()
} else {
  // Note: .agents/notes/workbench/standalone-editor-initial-theme.md
  // Every opaque app surface must use its persisted theme on first render.
  const themeReady = useThemeStore.getState().load()
  void Promise.all([i18nReady, themeReady]).then(renderRoot)
}
