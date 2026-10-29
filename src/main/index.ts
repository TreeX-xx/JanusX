import { app, BrowserWindow, crashReporter, dialog, ipcMain } from 'electron'
import { isAgentHookClientInvocation, runAgentHookClient } from './notifications/agent-hook-client'
import { configureApplicationProfile, configureChromiumSessionPaths } from './bootstrap/session'
import { migrateLegacyPortableProfile } from './bootstrap/profile-migration'
import { configureStartupDiagnostics, logStartupFailure } from './bootstrap/startup-diagnostics'
import { join } from 'node:path'
import { registerPluginScheme } from './plugins/scheme'

registerPluginScheme()

const isHookClient = isAgentHookClientInvocation()
const isLlmRuntimeSmoke = process.argv.includes('--smoke-test=llm-runtime')
const isModuleGraphSmoke = process.argv.includes('--smoke-test=module-graph')
const isSmokeTest = isLlmRuntimeSmoke || isModuleGraphSmoke

configureApplicationProfile(isHookClient || isSmokeTest)
if (!isHookClient && !isSmokeTest) configureStartupDiagnostics()
configureChromiumSessionPaths(isHookClient || isSmokeTest)

// AC1 / AC4: process-level exception fences.
// - Fatal exceptions during bootstrap (before app services are up) exit the
//   process so initialization failures are not masked.
// - Recoverable exceptions from pty/terminal/IPC callbacks (post-bootstrap) are
//   logged and swallowed so a single terminal failure cannot crash the whole
//   Electron process.
// - A burst of recoverable exceptions in a short window is treated as a
//   runaway main process and triggers app.relaunch() + app.exit() (AC4).
let bootstrapComplete = false
let recoverableBurst = 0
let burstResetTimer: ReturnType<typeof setTimeout> | null = null
const FATAL_BURST_THRESHOLD = 20
const FATAL_BURST_WINDOW_MS = 5000

function triggerFatalRelaunch(reason: string): void {
  console.error(`[main] fatal relaunch triggered: ${reason}`)
  try {
    if (app.isReady()) app.relaunch()
  } catch (err) {
    console.error('[main] app.relaunch failed:', err)
  }
  try {
    app.exit(1)
  } catch {
    process.exit(1)
  }
}

function handleRecoverableBurst(): void {
  recoverableBurst += 1
  if (burstResetTimer) clearTimeout(burstResetTimer)
  burstResetTimer = setTimeout(() => {
    recoverableBurst = 0
    burstResetTimer = null
  }, FATAL_BURST_WINDOW_MS)
  burstResetTimer.unref?.()
  if (recoverableBurst > FATAL_BURST_THRESHOLD) {
    triggerFatalRelaunch(`exception burst ${recoverableBurst} in ${FATAL_BURST_WINDOW_MS}ms`)
  }
}

process.on('uncaughtException', (err) => {
  logStartupFailure('[main] uncaughtException:', err)
  if (!bootstrapComplete) {
    // Fatal: bootstrap stage. Allow exit so failure is visible.
    process.exit(1)
    return
  }
  // Recoverable: swallow, but track burst to detect runaway main process.
  handleRecoverableBurst()
})

process.on('unhandledRejection', (reason) => {
  logStartupFailure('[main] unhandledRejection:', reason)
  if (!bootstrapComplete) {
    process.exit(1)
    return
  }
  handleRecoverableBurst()
})

if (isHookClient) {
  void runAgentHookClient()
    .catch(() => {})
    .finally(() => {
      process.exit(0)
    })
} else if (isLlmRuntimeSmoke) {
  void runLlmRuntimeSmoke()
} else if (isModuleGraphSmoke) {
  void runModuleGraphSmoke()
} else {
  void bootstrapApp().then(() => {
    bootstrapComplete = true
  }).catch((err) => {
    logStartupFailure('[main] bootstrapApp failed:', err)
    dialog.showErrorBox('JanusX 启动失败 / Startup failed', String(err))
    if (!bootstrapComplete) process.exit(1)
  })
}

async function runLlmRuntimeSmoke(): Promise<void> {
  try {
    await app.whenReady()
    const [aiRuntime, { llmService }] = await Promise.all([
      import('./llm/ai-runtime'),
      import('./llm/LlmService'),
    ])
    const missingExports = ['generateObject', 'generateText', 'streamText']
      .filter((name) => typeof aiRuntime[name as keyof typeof aiRuntime] !== 'function')
    if (missingExports.length > 0) {
      throw new Error(`AI Runtime exports unavailable: ${missingExports.join(', ')}`)
    }

    await llmService.initialize()
    const adapterIds = llmService.getAvailableAdapters().map((adapter) => adapter.id)
    for (const requiredAdapter of ['openai-compatible', 'vertex-ai']) {
      if (!adapterIds.includes(requiredAdapter)) {
        throw new Error(`LLM adapter unavailable: ${requiredAdapter}`)
      }
    }

    console.log(`[llm-runtime-smoke] ok adapters=${adapterIds.join(',')}`)
    app.exit(0)
  } catch (error) {
    console.error('[llm-runtime-smoke] failed:', error)
    app.exit(1)
  }
}

// The bootstrap module graph is shared with `--smoke-test=module-graph` so the
// packaged runtime check exercises every import startup performs. A dependency
// that packaging nested away from app.asar's node_modules root surfaces here as
// ERR_MODULE_NOT_FOUND, not as a missing feature at runtime.
// Note: entry — see .agents/notes/desktop/packaged-hoisted-deps.md
function importBootstrapModules() {
  return Promise.all([
    import('./ipc/handlers'),
    import('./ipc/project-handlers'),
    import('./ipc/llm-handlers'),
    import('./ipc/register'),
    import('./office/officecli-manager'),
    import('./bootstrap/services'),
    import('./terminal/manager'),
    import('./janus-runner/stream-manager'),
    import('./notifications/desktop-toast-window'),
    import('./shutdown/AppShutdown'),
    import('./windows/editor-window'),
    import('./windows/main-window'),
    import('./windows/register-window-ipc'),
    import('./remote-notifications/feishu-inbound/runtime'),
    import('./browser/surface-manager'),
  ])
}

async function runModuleGraphSmoke(): Promise<void> {
  try {
    await app.whenReady()
    await importBootstrapModules()
    // The remaining startup imports, resolved lazily by createWindow.
    await Promise.all([
      import('./updater/service'),
      import('./config/service'),
    ])
    console.log('[module-graph-smoke] ok')
    app.exit(0)
  } catch (error) {
    console.error('[module-graph-smoke] failed:', error)
    app.exit(1)
  }
}

async function bootstrapApp(): Promise<void> {
  // Lock before migration and before importing modules that open profile stores.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
  const explicitProfile = process.argv.some(arg => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))
  if (app.isPackaged && portableRoot && !explicitProfile && app.getPath('userData') === join(app.getPath('appData'), 'JanusX-Portable')) {
    try {
      migrateLegacyPortableProfile(portableRoot, app.getPath('userData'))
    } catch (error) {
      throw new Error(`旧数据迁移未完成，请关闭旧版 JanusX 后重试。原数据已保留；如有冲突，请备份并处理后重启。\nLegacy profile migration failed; close older JanusX instances and resolve conflicts before retrying.\n${join(portableRoot, 'data')} → ${app.getPath('userData')}\n${String(error)}`)
    }
  }
  const { initializeWorkspaceStorage } = await import('./storage/service')
  initializeWorkspaceStorage()
  const [
    { disposeWorkspaceWatchers },
    { stopAllProjects },
    { abortAllChatStreams, refreshLlmRuntimeStatus },
    { registerApplicationIpc },
    { initializeOfficecliProvider, officecliManager },
    { createApplicationServices },
    { terminalManager },
    { agentStreamManager },
    { desktopToastWindow },
    { appShutdown },
    { EditorWindowManager },
    { createMainWindow },
    { registerWindowIpc },
    { feishuInboundRuntime },
    { BrowserSurfaceManager },
  ] = await importBootstrapModules()

  // Resolve persisted theme before any startup/second-instance window can be created.
  // Note: .agents/notes/workbench/standalone-editor-initial-theme.md
  const { configService } = await import('./config/service')
  await configService.getTheme()

  let mainWindow: BrowserWindow | null = null
  let quitAck: (() => void) | null = null
  ipcMain.on('app:prepareQuitAck', () => { quitAck?.(); quitAck = null })
  const editorWindows = new EditorWindowManager()
  const browserSurfaces = new BrowserSurfaceManager({ getMainWindow: () => mainWindow })
  const getOfficeWindows = (): BrowserWindow[] => [
    ...(mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : []),
    ...editorWindows.list(),
  ]
  const { resolveOfficeWorkspaceRoot, officeWatchPool, officeArtifactIndex } =
    createApplicationServices(getOfficeWindows)

  appShutdown.configure({
    abortChatStreams: () => abortAllChatStreams(),
    killTerminals: () => terminalManager.killAll(),
    killAgents: () => agentStreamManager.killAll(),
    stopProjects: async () => {
      await Promise.all([stopAllProjects(), import('./ipc/agent-runtime-handlers').then(module => module.closeAgentMcp())])
    },
    stopOfficeWatches: () => officeWatchPool.stopAll(),
    disposeOfficeArtifactIndexes: () => officeArtifactIndex.disposeAll(),
    disposeWatchers: () => disposeWorkspaceWatchers(),
    destroyToast: () => desktopToastWindow.destroy(),
    closeEditors: () => editorWindows.closeAll(),
    destroyBrowserSurfaces: () => browserSurfaces.destroyAll(),
    stopCompanion: () => feishuInboundRuntime.stop(),
  })

  function createWindow(): void {
    mainWindow = createMainWindow(() => {
      officeArtifactIndex.disposeAll()
      void feishuInboundRuntime.stop()
      mainWindow = null
      if (process.platform === 'darwin') return
      if (appShutdown.isQuitting) return
      app.quit()
    })
    registerApplicationIpc({
      mainWindow,
      getAllowedWindows: getOfficeWindows,
      resolveWorkspaceRoot: resolveOfficeWorkspaceRoot,
      officeWatchPool,
      officeArtifactIndex,
      browserSurfaces,
    })
    registerWindowIpc(editorWindows, () => mainWindow)
    feishuInboundRuntime.configure(mainWindow)
    // Win P0 自动更新：读持久化开关，延迟首检 + 6h 轮询；其余形态内部降级。
    void Promise.all([import('./updater/service'), import('./config/service')]).then(
      ([{ updateService }, { configService }]) => {
        updateService.setMainWindow(mainWindow)
        void configService.getUpdaterSettings().then(
          (settings) => {
            updateService.setAutoCheck(settings.autoCheck)
            updateService.startAutoCheck()
          },
          () => updateService.startAutoCheck(),
        )
      },
    ).catch((err) => {
      console.error('[updater] service init failed:', err)
    })
    void feishuInboundRuntime.reconfigure()
  }

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow()
      return
    }

    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    // Keep macOS app alive until explicit quit; other platforms exit.
    if (process.platform === 'darwin') return
    if (appShutdown.isQuitting) return
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (appShutdown.isQuitting) return
    event.preventDefault()
    const ack = mainWindow && !mainWindow.isDestroyed()
      ? new Promise<void>((resolve) => {
          quitAck = resolve
          mainWindow!.webContents.send('app:prepareQuit')
          setTimeout(resolve, 1_000).unref?.()
        })
      : Promise.resolve()
    void ack.then(() => appShutdown.beginQuit({ reason: 'before-quit' }))
  })

  // I-2 [P2] AC1: await app.whenReady() inside bootstrapApp's async flow so
  // createWindow() runs before bootstrapApp resolves. A throw from
  // createMainWindow / registerApplicationIpc / registerWindowIpc inside
  // createWindow rejects bootstrapApp, which the outer .catch turns into
  // process.exit(1) — failure is visible, not masked by bootstrapComplete
  // already being true. bootstrapComplete is set by the outer .then only
  // after bootstrapApp resolves, i.e. only after createWindow succeeded.
  await app.whenReady()
  // AC4: local-only crash dump; never uploads. Relaunch path is handled
  // by triggerFatalRelaunch on runaway exception bursts.
  try {
    crashReporter.start({ submitURL: '', uploadToServer: false })
  } catch (err) {
    console.error('[main] crashReporter.start failed:', err)
  }
  const { resolveBundledOfficecliBinary } = await import('./office/office-bundled-path')
  officecliManager.configureBundledBinaryPath(
    // Note: development assets live in the checkout — .agents/notes/desktop/officecli-bundled.md
    resolveBundledOfficecliBinary({ resourcesPath: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources') }),
  )
  await initializeOfficecliProvider()
  const { retireEngineeringAssets } = await import('./knowledge/retire-engineering-assets')
  await retireEngineeringAssets().catch(() => console.warn('[memory] Some legacy engineering assets could not be retired; personal storage was retained'))
  createWindow()
  void refreshLlmRuntimeStatus()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
