import { randomUUID } from 'node:crypto'
import { workspaceIo } from '@janus-agent/agent-core'
import type { TerminalTurnChangesEvent, TurnChangeKind } from '../../shared/ipc/terminal'
import { captureTurnFiles, compareTurnFiles, type TurnFileSnapshot } from './turn-file-snapshot'

interface TerminalTracking {
  cwd: string
  baseline?: TurnFileSnapshot
  activeTurn?: string
  sequence: number
  baselineSequence: number
  queue: Promise<void>
  abort: AbortController
}

// Note: adjacent completed turns own independent file baselines — see .agents/notes/terminal/terminal-right-island-turn-history.md
export class TerminalTurnChangeTracker {
  private terminals = new Map<string, TerminalTracking>()

  constructor(
    private readonly publish: (event: TerminalTurnChangesEvent) => void,
    private readonly capture = captureTurnFiles,
    private readonly reportError: (error: unknown) => void = error => console.error('[terminal] turn snapshot failed:', error),
  ) {}

  register(id: string, cwd: string): Promise<void> {
    this.unregister(id)
    const state: TerminalTracking = { cwd, sequence: 0, baselineSequence: 0, queue: Promise.resolve(), abort: new AbortController() }
    this.terminals.set(id, state)
    state.queue = this.capture(cwd, state.abort.signal).then(snapshot => {
      if (this.terminals.get(id) === state) state.baseline = snapshot
    }).catch(error => { if (!state.abort.signal.aborted) this.reportError(error) })
    return state.queue
  }

  start(id: string): void {
    const state = this.terminals.get(id)
    if (state && !state.activeTurn) state.activeTurn = randomUUID()
  }

  /** True while a started turn has not finished; duplicate ends check this. */
  hasActiveTurn(id: string): boolean {
    return this.terminals.get(id)?.activeTurn !== undefined
  }

  finish(id: string, kind: TurnChangeKind, checkpointId: string | null): Promise<void> {
    const state = this.terminals.get(id)
    if (!state?.activeTurn) return Promise.resolve()
    const turnId = state.activeTurn
    state.activeTurn = undefined
    const sequence = ++state.sequence
    const endedAt = new Date().toISOString()
    state.queue = workspaceIo.run(state.cwd, async () => {
      if (this.terminals.get(id) !== state) return
      const current = await this.capture(state.cwd, state.abort.signal)
      if (this.terminals.get(id) !== state) return
      const available = state.baseline !== undefined && state.baselineSequence === sequence - 1
      const files = available ? compareTurnFiles(state.baseline!, current) : []
      if (state.baselineSequence < sequence) {
        state.baseline = current
        state.baselineSequence = sequence
      }
      this.publish({
        id, turnId, sequence, kind, checkpointId, endedAt, available,
        files: files.slice(0, 100), fileCount: files.length,
        additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
      })
    }, { signal: state.abort.signal, background: true }).catch(error => {
      if (this.terminals.get(id) !== state) return
      // A failed boundary cannot become a cumulative diff on the next turn.
      if (state.baselineSequence < sequence) {
        state.baseline = undefined
        state.baselineSequence = sequence
      }
      this.reportError(error)
      this.publish({ id, turnId, sequence, kind, checkpointId, endedAt, available: false, files: [], fileCount: 0, additions: 0, deletions: 0 })
    })
    return state.queue
  }

  unregister(id: string): void {
    this.terminals.get(id)?.abort.abort()
    this.terminals.delete(id)
  }
}
