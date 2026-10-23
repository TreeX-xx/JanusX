import { memo, useRef, useEffect, useLayoutEffect, useCallback, useState, type DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@xterm/xterm/css/xterm.css'
import {
  formatTerminalFileReference,
  hasWorkspaceFileDrag,
  readWorkspaceFileDragData,
} from '@/lib/terminal-file-reference'
import {
  applyTerminalInputChunk,
  createTerminalInputTransactionState,
  normalizeTerminalInputPreviewText,
} from '@/lib/terminal-input-transaction'
import { handleCodexMultilineInput, isCodexMultilineShortcut } from '@/lib/codex-terminal-input'
import { createTerminalScrollIntentController } from '@/lib/terminal-scroll-intent'
import { attachTerminalTuiWheelHandler } from '@/lib/terminal-tui-wheel'
import { registerTerminalNavigation, handleTerminalPageKey } from '@/lib/terminal-navigation'
import {
  extractDshTurnStatus,
  mergeRuntimeTelemetrySnapshot,
  type RuntimeTelemetrySnapshot,
} from '@/lib/runtime-telemetry'
import {
  clearTerminalGeometry,
  registerTerminalForceFit,
  reportTerminalGeometry,
  unregisterTerminalForceFit,
} from '@/lib/terminal-geometry'
import {
  createTerminalRecoveryScheduler,
  finalizeTerminalReplay,
  recoverTerminalViewportAndSync,
  type TerminalGeometrySize,
} from '@/lib/terminal-viewport-resize'
import { createTerminalOutputScheduler } from '@/lib/terminal-output-scheduler'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useThemeDefinition, useThemeStore } from '@/stores/theme'
import type { TerminalDataEvent, TerminalReplayResult } from '../../../shared/ipc/terminal'
import {
  getXtermPalette,
  isDefaultColorQuery,
} from '../../../shared/terminalColorQuery'

interface CLITerminalProps {
  terminalId: string
  visible?: boolean
  focused?: boolean
  workspaceVisible?: boolean
}


export const CLITerminal = memo(function CLITerminal({
  terminalId,
  visible = true,
  focused = false,
  workspaceVisible = true,
}: CLITerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const activateViewportRef = useRef<(() => void) | null>(null)
  const focusedRef = useRef(focused)
  const visibleRef = useRef(visible)
  const workspaceVisibleRef = useRef(workspaceVisible)
  const visibilityRecoveryTimerRef = useRef<number | null>(null)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [rendererGeneration, setRendererGeneration] = useState(0)
  const [hasRenderedOutput, setHasRenderedOutput] = useState(false)
  const { t } = useTranslation('terminal')
  const pid = useWorkspaceStore((s) => s.terminals.find((terminal) => terminal.id === terminalId)?.pid)
  const exited = useWorkspaceStore((s) => {
    const terminal = s.terminals.find((item) => item.id === terminalId)
    return Boolean(terminal?.errorMessage) || terminal?.exitCode !== undefined
  })
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const panelCollapsed = useAppStore((s) => s.panelCollapsed)
  const themeDefinition = useThemeDefinition()

  const applyTelemetryPatch = useCallback((telemetry: RuntimeTelemetrySnapshot) => {
    const store = useWorkspaceStore.getState()
    const terminal = store.terminals.find((item) => item.id === terminalId)
    if (!terminal) return

    const patch = mergeRuntimeTelemetrySnapshot(terminal, telemetry)

    if (Object.keys(patch).length === 0) return
    store.updateTerminal(terminalId, patch)
  }, [terminalId])

  // dsh owns no hook pipeline (phase 1): PTY turn markers assert running on
  // the live turn header and degraded on a turn error. Forward-only: idle is
  // never inferred here (a successful turn end has no observed marker yet),
  // so a quiet terminal keeps whatever the lifecycle paths last reported.
  const applyDshTurnStatus = useCallback((data: string) => {
    const turnStatus = extractDshTurnStatus(data)
    if (!turnStatus) return
    const store = useWorkspaceStore.getState()
    const terminal = store.terminals.find((item) => item.id === terminalId)
    if (!terminal || terminal.preset !== 'dsh') return
    const next = turnStatus === 'running' ? 'running' : 'degraded'
    if (terminal.status === next) return
    if (terminal.status === 'needs-approval' || terminal.status === 'needs-input' || terminal.status === 'error') return
    store.updateTerminal(terminalId, { status: next, updatedAt: Date.now() })
  }, [terminalId])

  useEffect(() => {
    let cancelled = false

    const pollHistoryTelemetry = async () => {
      const terminal = useWorkspaceStore.getState().terminals.find((item) => item.id === terminalId)
      if (!terminal || terminal.preset === 'shell') return

      try {
        const result = await window.electron.system.getRuntimeTelemetry({
          terminalId,
          preset: terminal.preset,
          cwd: terminal.cwd,
          startedAt: terminal.telemetryStartedAt,
          sessionId: terminal.telemetrySessionId,
        })
        if (cancelled || !result || typeof result !== 'object') return
        applyTelemetryPatch(result as RuntimeTelemetrySnapshot)
      } catch {
        // History telemetry is opportunistic; terminal rendering must not depend on it.
      }
    }

    void pollHistoryTelemetry()
    const unsubscribeTelemetry = window.electron.terminal.onTelemetry(({ id, telemetry }) => {
      if (id === terminalId) applyTelemetryPatch(telemetry)
    })

    return () => {
      cancelled = true
      unsubscribeTelemetry()
    }
  }, [terminalId, applyTelemetryPatch])

  useLayoutEffect(() => {
    focusedRef.current = focused
    visibleRef.current = visible
    workspaceVisibleRef.current = workspaceVisible
  }, [focused, visible, workspaceVisible])

  useLayoutEffect(() => {
    // A warm tab already has its viewport and buffer. Request its paint before
    // the next frame; only a changed host needs another FitAddon pass.
    if (visible) activateViewportRef.current?.()
  }, [visible])

  useLayoutEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  useEffect(() => {
    // Returning from display:none can settle geometry later. Keep the late
    // recovery for workspace activation, rather than for every tab/focus click.
    if (!workspaceVisible) return
    visibilityRecoveryTimerRef.current = window.setTimeout(() => {
      visibilityRecoveryTimerRef.current = null
      if (visibleRef.current) fitRef.current?.()
    }, 64)
    return () => {
      if (visibilityRecoveryTimerRef.current !== null) window.clearTimeout(visibilityRecoveryTimerRef.current)
      visibilityRecoveryTimerRef.current = null
    }
  }, [workspaceVisible])

  // Side panel collapse/expand changes the center grid width; force a late refit
  // after the transition, matching the manual "toggle panel to recover" workaround.
  useEffect(() => {
    fitRef.current?.()
  }, [sidebarCollapsed, panelCollapsed])

  // 主题切换：热更新 xterm palette，无需重启 PTY、不丢 replay。
  // 已运行的 TUI 应用缓存了启动色，切换后需 pane 重绘/重启以纠正对比。
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = { ...themeDefinition.xterm }
  }, [themeDefinition])

  useEffect(() => {
    if (!containerRef.current) return

    /*-- Windows 下传 windowsPty，让 xterm 按 ConPTY 模式处理行重排/光标语义，修正 IME 定位，对齐 VS Code --*/
    /*-- platform/windowsBuild 由 preload 同步暴露；非 Windows 传 undefined，零回归 --*/
    const windowsPty =
      window.electron.platform === 'win32'
        ? { backend: 'conpty' as const, buildNumber: window.electron.windowsBuild }
        : undefined

    /*-- 仅 Windows + conpty 时启用：xterm 行重排时把光标放到正确行，helper-textarea --*/
    /*-- （IME 候选栏锚点）随之贴住光标，修正候选栏定位。issue #274372，前提是 useConptyDll --*/
    const reflowCursorLine = windowsPty?.backend === 'conpty'

    const term = new Terminal({
      theme: {
        /*-- 与 --shell-canvas 对齐：终端画布与中部工作台同色，避免 pane 内出现色阶断层 --*/
        /*-- planche 下由 getXtermPalette 提供纸面 palette，切换时经下方 effect 热更新，无需重启 PTY --*/
        ...getXtermPalette(useThemeStore.getState().theme),
      },
      fontFamily: '"SF Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.4,
      letterSpacing: 0.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: 5000,
      scrollSensitivity: 1.15,
      fastScrollSensitivity: 5,
      allowTransparency: true,
      windowsPty,
      reflowCursorLine,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    const terminalPreset = useWorkspaceStore.getState().terminals.find(
      (terminal) => terminal.id === terminalId,
    )?.preset
    const colorQueryDisposables = terminalPreset === 'codex'
      ? [
          term.parser.registerOscHandler(10, isDefaultColorQuery),
          term.parser.registerOscHandler(11, isDefaultColorQuery),
        ]
      : []

    const hostElement = containerRef.current
    // A spawned PTY or an ANSI-only packet is not a painted prompt. Keep the
    // startup hint until xterm has actually rendered visible text (including replay).
    let firstOutputRendered = false
    const renderDisposable = term.onRender(({ start, end }) => {
      if (firstOutputRendered) return
      const buffer = term.buffer.active
      for (let row = start; row <= end; row++) {
        if (!buffer.getLine(buffer.viewportY + row)?.translateToString(true).trim()) continue
        firstOutputRendered = true
        setHasRenderedOutput(true)
        break
      }
    })
    const hostParent = hostElement.parentElement
    const scrollIntent = createTerminalScrollIntentController(term)
    const unregisterNavigation = registerTerminalNavigation(terminalId, term, direction => {
      scrollIntent.beginUserScroll()
      term.scrollPages(direction)
      scrollIntent.commitUserScroll()
    })
    attachTerminalTuiWheelHandler(term)
    hostElement.dataset.bufferType = term.buffer.active.type
    const bufferChangeDisposable = term.buffer.onBufferChange((buffer) => {
      hostElement.dataset.bufferType = buffer.type
      scrollIntent.handleBufferChange(buffer.type)
    })
    const scrollbarElement = hostElement.querySelector<HTMLElement>(
      '.xterm .xterm-scrollable-element > .scrollbar.vertical'
    )
    const finishScrollbarInteraction = () => {
      window.removeEventListener('pointerup', finishScrollbarInteraction)
      window.removeEventListener('blur', finishScrollbarInteraction)
      scrollIntent.commitUserScroll()
    }
    const handleScrollbarPointerDown = () => {
      if (term.buffer.active.type !== 'normal') return
      scrollIntent.beginUserScroll()
      window.addEventListener('pointerup', finishScrollbarInteraction)
      window.addEventListener('blur', finishScrollbarInteraction)
    }
    scrollbarElement?.addEventListener('pointerdown', handleScrollbarPointerDown, true)

    let pendingSoftEnterCount = 0
    let win32InputMode = false
    let inputTransactionState = createTerminalInputTransactionState()

    const commitSubmittedInput = () => {
      const text = normalizeTerminalInputPreviewText(inputTransactionState.text)
      inputTransactionState = { ...inputTransactionState, text: '' }
      if (!text.trim()) return

      window.electron.terminal.submitLine(terminalId, text)
    }

    const trackInputData = (data: string) => {
      const result = applyTerminalInputChunk(inputTransactionState, data, {
        softEnterCount: pendingSoftEnterCount,
      })
      inputTransactionState = result.state
      pendingSoftEnterCount = result.softEnterCount
      if (result.commitNow) {
        commitSubmittedInput()
      }
    }

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (handleTerminalPageKey(term, e)) return false
      const terminal = useWorkspaceStore.getState().terminals.find((item) => item.id === terminalId)
      const codexMultilineResult = handleCodexMultilineInput(
        terminal?.preset,
        e,
        (data) => window.electron.terminal.input(terminalId, data),
        (data) => {
          pendingSoftEnterCount += 1
          trackInputData(data)
        },
        win32InputMode,
      )
      if (codexMultilineResult !== null) return codexMultilineResult

      if (isCodexMultilineShortcut(terminal?.preset, e)) {
        pendingSoftEnterCount += 1
        return true
      }

      if (e.type === 'keydown' && e.key === 'Enter' && (e.shiftKey || e.altKey)) {
        pendingSoftEnterCount += 1
        return true
      }

      if (e.type === 'keydown' && e.ctrlKey && e.key.toLowerCase() === 'j') {
        pendingSoftEnterCount += 1
        return true
      }

      const isCtrl = e.ctrlKey || e.metaKey
      if (!isCtrl) return true

      // Ctrl+C — 有选中内容时复制，否则放行（发送 \x03 中断信号）
      if (e.key === 'c') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection())
          e.preventDefault()
          return false
        }
        return true
      }

      // Ctrl+V — 从剪贴板粘贴，统一走 onData 转发到 PTY 并追踪提交行
      if (e.key.toLowerCase() === 'v') {
        e.preventDefault()
        e.stopPropagation()
        if (e.type !== 'keydown') return false

        navigator.clipboard.readText().then((text) => {
          if (text) {
            term.paste(text)
          }
        }).catch(() => {})
        return false
      }

      // Ctrl+A — 全选
      if (e.key === 'a') {
        term.selectAll()
        return false
      }

      return true
    })

    const win32InputModeEnableDisposable = term.parser.registerCsiHandler(
      { prefix: '?', final: 'h' },
      (params) => {
        if (!params.some((param) => param === 9001 || (Array.isArray(param) && param.includes(9001)))) {
          return false
        }
        win32InputMode = true
        return true
      },
    )
    const win32InputModeDisableDisposable = term.parser.registerCsiHandler(
      { prefix: '?', final: 'l' },
      (params) => {
        if (!params.some((param) => param === 9001 || (Array.isArray(param) && param.includes(9001)))) {
          return false
        }
        win32InputMode = false
        return true
      },
    )

    let lastSyncedGeometry: TerminalGeometrySize | null = null
    let fittedHostSize: { width: number; height: number } | null = null
    const fitAndSync = () => {
      try {
        if (!workspaceVisibleRef.current) return false
        const host = containerRef.current
        // Avoid reporting a degenerate size before layout settles.
        if (!host || host.clientWidth < 80 || host.clientHeight < 60) return false

        const fitResult = recoverTerminalViewportAndSync({
          hostWidth: host.clientWidth,
          hostHeight: host.clientHeight,
          terminal: term,
          fit: () => fitAddon.fit(),
          captureViewport: scrollIntent.capture,
          restoreViewport: (snapshot) => scrollIntent.enforce(snapshot as ReturnType<typeof scrollIntent.capture>),
          refresh: (start, end) => term.refresh(start, end),
          previousGeometry: lastSyncedGeometry,
          reportGeometry: (cols, rows) => reportTerminalGeometry(terminalId, cols, rows),
          resizePty: (cols, rows) => window.electron.terminal.resize(terminalId, cols, rows),
        })
        // A layout refit must not steal focus from workspace controls or text fields.
        const activeElement = document.activeElement
        if (focusedRef.current && (!activeElement || activeElement === document.body || hostElement.contains(activeElement))) {
          term.focus()
        }

        if (!fitResult.geometry) return false
        fittedHostSize = { width: host.clientWidth, height: host.clientHeight }
        if (fitResult.sizeChanged) lastSyncedGeometry = fitResult.geometry

        return fitResult.sizeChanged
      } catch {
        // ignore fit errors during initial layout
        return false
      }
    }

    const recoveryScheduler = createTerminalRecoveryScheduler()
    const scheduleRecovery = () => recoveryScheduler.schedule(() => fitAndSync())
    fitRef.current = scheduleRecovery
    activateViewportRef.current = () => {
      const host = containerRef.current
      if (!host || !workspaceVisibleRef.current) return
      if (fittedHostSize?.width === host.clientWidth && fittedHostSize?.height === host.clientHeight) {
        term.refresh(0, term.rows - 1)
      } else {
        // Let xterm resume its own viewport before resizing a previously hidden
        // workspace. Resizing it during the visibility commit can pin old rows.
        scheduleRecovery()
      }
    }
    registerTerminalForceFit(terminalId, scheduleRecovery)

    // Establish xterm and PTY geometry before requesting replay. Inactive tabs
    // are CSS-hidden but measurable, and alternate buffers need the right size
    // before their output is reconstructed.
    fitAndSync()

    // Recheck after committed frames because surrounding layout may still settle.
    scheduleRecovery()

    const observer = new ResizeObserver(() => {
      scheduleRecovery()
    })
    observer.observe(hostElement)
    if (hostParent) {
      // Observe the pane host too: grid column changes sometimes resize the parent first.
      observer.observe(hostParent)
    }
    const handleWindowRecovery = () => {
      if (document.visibilityState === 'visible') scheduleRecovery()
    }
    window.addEventListener('focus', handleWindowRecovery)
    document.addEventListener('visibilitychange', handleWindowRecovery)

    let suppressReplayResponses = false

    term.onData((data) => {
      if (suppressReplayResponses) return
      window.electron.terminal.input(terminalId, data)
      trackInputData(data)
    })

    // 输出 ← IPC
    let replayReady = false
    let replaySeq = 0
    let disposed = false
    const queuedLiveOutput: TerminalDataEvent[] = []

    const markViewportInteraction = () => scrollIntent.recordUserScroll()
    const handleViewportKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End') {
        markViewportInteraction()
      }
    }
    hostElement.addEventListener('wheel', markViewportInteraction, { capture: true })
    hostElement.addEventListener('keydown', handleViewportKeyDown, { capture: true })

    const outputScheduler = createTerminalOutputScheduler({
      write: (data, onParsed) => term.write(data, onParsed),
      beforeWrite: scrollIntent.capture,
      afterWrite: (snapshot) => scrollIntent.enforce(snapshot as ReturnType<typeof scrollIntent.capture>),
      onRecoveryRequired: (reason) => {
        if (disposed) return
        console.warn(`Terminal ${terminalId} renderer recovery requested: ${reason}`)
        setRendererGeneration((generation) => generation + 1)
      },
    })

    const writeLiveOutput = (data: string) => {
      outputScheduler.enqueue(data)
      applyDshTurnStatus(data)
    }

    const flushQueuedLiveOutput = () => {
      for (const payload of queuedLiveOutput) {
        if (payload.seq !== undefined && payload.seq <= replaySeq) continue
        writeLiveOutput(payload.data)
        if (payload.seq !== undefined) {
          replaySeq = Math.max(replaySeq, payload.seq)
        }
      }
      queuedLiveOutput.length = 0
    }

    const unsubscribe = window.electron.terminal.onData(({ id, data, seq }) => {
      if (id !== terminalId) return

      if (!replayReady) {
        queuedLiveOutput.push({ id, data, seq })
        return
      }
      if (seq !== undefined && seq <= replaySeq) return
      writeLiveOutput(data)
      if (seq !== undefined) {
        replaySeq = Math.max(replaySeq, seq)
      }
    })

    void window.electron.terminal.replay(terminalId)
      .then((payload) => {
        if (disposed) return
        const replay = payload as TerminalReplayResult
        const data = typeof replay.data === 'string' ? replay.data : ''
        replaySeq = typeof replay.seq === 'number' ? replay.seq : 0
        const finishReplay = () => {
          if (disposed) return
          finalizeTerminalReplay({
            releaseInput: () => { suppressReplayResponses = false },
            markReady: () => { replayReady = true },
            flushLiveOutput: flushQueuedLiveOutput,
            scheduleRecovery,
          })
        }

        if (!data) {
          finishReplay()
          return
        }

        suppressReplayResponses = true
        outputScheduler.enqueue(data, finishReplay)
      })
      .catch(() => {
        if (disposed) return
        finalizeTerminalReplay({
          releaseInput: () => { suppressReplayResponses = false },
          markReady: () => { replayReady = true },
          flushLiveOutput: flushQueuedLiveOutput,
          scheduleRecovery,
        })
      })

    termRef.current = term

    return () => {
      disposed = true
      unregisterNavigation()
      outputScheduler.dispose()
      unregisterTerminalForceFit(terminalId)
      clearTerminalGeometry(terminalId)
      bufferChangeDisposable.dispose()
      renderDisposable.dispose()
      win32InputModeEnableDisposable.dispose()
      win32InputModeDisableDisposable.dispose()
      for (const disposable of colorQueryDisposables) disposable.dispose()
      delete hostElement.dataset.bufferType
      scrollbarElement?.removeEventListener('pointerdown', handleScrollbarPointerDown, true)
      window.removeEventListener('pointerup', finishScrollbarInteraction)
      window.removeEventListener('blur', finishScrollbarInteraction)
      observer.disconnect()
      window.removeEventListener('focus', handleWindowRecovery)
      document.removeEventListener('visibilitychange', handleWindowRecovery)
      hostElement.removeEventListener('wheel', markViewportInteraction, { capture: true })
      hostElement.removeEventListener('keydown', handleViewportKeyDown, { capture: true })
      recoveryScheduler.cancel()
      if (visibilityRecoveryTimerRef.current !== null) {
        window.clearTimeout(visibilityRecoveryTimerRef.current)
        visibilityRecoveryTimerRef.current = null
      }
      unsubscribe()
      term.dispose()
      termRef.current = null
      if (fitRef.current) fitRef.current = null
      activateViewportRef.current = null
    }
  }, [terminalId, rendererGeneration, applyDshTurnStatus])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasWorkspaceFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFileDragOver(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFileDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const payload = readWorkspaceFileDragData(event.dataTransfer)
    if (!payload) return

    event.preventDefault()
    setFileDragOver(false)

    const reference = formatTerminalFileReference(payload.path)
    const term = termRef.current
    if (term) {
      term.focus()
      term.paste(reference)
      return
    }

    window.electron.terminal.input(terminalId, reference)
  }, [terminalId])

  return (
    <>
      <div
        ref={containerRef}
        className="cli-terminal w-full h-full transition-[box-shadow,background]"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          boxShadow: fileDragOver ? 'inset 0 0 0 1px rgba(255, 120, 48, 0.45)' : 'none',
          background: fileDragOver ? 'rgba(255, 120, 48, 0.035)' : 'transparent',
        }}
      />
      {!hasRenderedOutput && !exited && (
        <div
          role="status"
          className="pointer-events-none absolute left-5 top-4 flex items-center gap-2 text-[12px] text-[var(--shell-muted)]"
        >
          <LoaderCircle size={14} aria-hidden="true" className="motion-safe:animate-spin" />
          <span>{t(pid ? 'startup.waitingForOutput' : 'startup.starting')}</span>
        </div>
      )}
    </>
  )
})
