import { normalizeHookLifecycle } from '../notifications/agent-hook-lifecycle'
import type { AgentHookSemantic, AgentHookCompletionKind } from '../notifications/agent-hook-types'
import { resolveOpencodeDbPath } from '../sessions/opencode-store-path'
import type { AgentEngine } from '../janus-runner/types'
import { memoryDomainPolicy } from './memory-domain-policy'
import {
  type AgentHookPayload,
  type RegisteredHookTerminal,
} from '../notifications/agent-hook-types'
import { knowledgeCaptureInbox, type CaptureEntry } from './capture-inbox'
import { SerialQueue } from '../lib/atomic-file'
import { knowledgeTranscriptRecovery } from './transcript-recovery'
import { knowledgeObservationService } from './observation-service'
import { knowledgeProcessingQueue } from './processing-queue'
import { createHash, randomUUID } from 'node:crypto'
import { redactHighConfidenceSecrets } from '@janus-agent/agent-core'
import { isRuntimeNotification } from './personal-memory-content'

interface ActiveTurn {
  id: string
  observationId?: string
  terminalId: string
  engine: AgentEngine
  workspaceId?: string
  workspacePath: string
  prompt?: string
  promptHash?: string
  sessionId?: string
  startedAt: string
  startedAtMs: number
}

interface TerminalContext extends RegisteredHookTerminal {
  cwd: string
}

export interface AgentTurnRecorderEvent {
  type: 'captured' | 'skipped' | 'failed'
  reason?: string
  terminalId?: string
  engine?: AgentEngine
  hookEvent: string
  workspaceId?: string
  workspacePath?: string
  observationId?: string
}

function normalizePath(value?: string): string | undefined {
  return value?.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase() || undefined
}

function hasText(value?: string): value is string {
  return Boolean(value?.trim())
}

function timestampToMs(timestamp?: string): number | undefined {
  if (!timestamp) return undefined
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : undefined
}

export class AgentTurnRecorder {
  private epoch = 0
  private enabled = false
  private recoveryFlight?: Promise<void>
  private readonly deliveryIds = new WeakMap<AgentHookPayload, string>()
  private readonly queue = new SerialQueue()
  private retryTimer?: ReturnType<typeof setInterval>
  private readonly terminals = new Map<string, TerminalContext>()
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private eventSink?: (event: AgentTurnRecorderEvent) => void

  registerTerminal(terminal: TerminalContext): void {
    this.terminals.set(terminal.terminalId, terminal)
    void this.refreshPolicy()
  }

  async refreshPolicy(): Promise<void> {
    const epoch = this.epoch
    const enabled = await this.isEnabled()
    if (epoch !== this.epoch) return
    if (!enabled) {
      this.epoch++
      this.activeTurns.clear()
      clearInterval(this.retryTimer)
      this.retryTimer = undefined
    } else if (!this.retryTimer && (this.terminals.size || this.eventSink)) {
      this.retryTimer = setInterval(() => { void this.recover() }, 10000)
      this.retryTimer.unref()
      void this.recover()
    }
    this.enabled = enabled
  }

  async isCaptureEnabled(): Promise<boolean> {
    await this.refreshPolicy()
    return this.enabled
  }

  private recover(): Promise<void> {
    if (this.recoveryFlight) return this.recoveryFlight
    const flight = this.runRecovery()
    this.recoveryFlight = flight
    void flight.finally(() => { if (this.recoveryFlight === flight) this.recoveryFlight = undefined }).catch(() => {})
    return flight
  }

  async settle(): Promise<void> {
    await this.queue.run(async () => {})
    await this.recoveryFlight
  }

  private async runRecovery(): Promise<void> {
    const epoch = this.epoch
    const enabled = () => this.isCurrent(epoch)
    try {
      if (!await enabled()) return
      await knowledgeCaptureInbox.drain(enabled)
      if (!await enabled()) return
      for (const observation of await knowledgeTranscriptRecovery.drain(enabled)) {
        if (!await enabled()) return
        knowledgeProcessingQueue.scheduleImmediate(observation.workspaceId)
      }
    } catch (error) { console.warn('[knowledge] capture recovery failed:', error instanceof Error ? error.message : String(error)) }
  }

  setEventSink(sink?: (event: AgentTurnRecorderEvent) => void): void {
    this.eventSink = sink
    if (sink) void this.refreshPolicy()
  }

  private async isCurrent(epoch: number): Promise<boolean> {
    return epoch === this.epoch && await this.isEnabled() && epoch === this.epoch
  }

  unregisterTerminal(terminalId: string): void {
    this.terminals.delete(terminalId)
    this.activeTurns.delete(terminalId)
  }

  dispose(): void {
    this.epoch++
    this.enabled = false
    clearInterval(this.retryTimer)
    this.retryTimer = undefined
    this.terminals.clear()
    this.activeTurns.clear()
  }

  async handleHookPayload(payload: AgentHookPayload, semantic = normalizeHookLifecycle(payload)): Promise<void> {
    if (!await this.isCaptureEnabled()) return
    const epoch = this.epoch
    const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw as Record<string, unknown> : {}
    if (!payload.timestamp && !raw.event_id && !raw.eventId && !raw.message_id && !raw.tool_use_id && !raw.call_id) {
      let deliveryId = this.deliveryIds.get(payload)
      if (!deliveryId) { deliveryId = randomUUID(); this.deliveryIds.set(payload, deliveryId) }
      payload = { ...payload, raw: { ...raw, captureDeliveryId: deliveryId } }
    }
    return this.queue.run(async () => {
      if (await this.isCurrent(epoch)) await this.recordHookPayload(payload, epoch, semantic)
    }).catch(async (error) => {
      if (!await this.isCurrent(epoch)) return
      this.emit({
        type: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        terminalId: payload.terminalId,
        engine: payload.source,
        hookEvent: payload.event,
        workspaceId: payload.workspaceId,
        workspacePath: payload.cwd,
      })
      console.warn(
        '[knowledge] failed to record agent hook observation:',
        error instanceof Error ? error.message : String(error),
      )
    })
  }

  private async isEnabled(): Promise<boolean> {
    return (await memoryDomainPolicy()).inferEngineeringHabits
  }

  private eventId(payload: AgentHookPayload): string {
    const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw as Record<string, unknown> : {}
    const identity = raw.event_id ?? raw.eventId ?? raw.message_id ?? raw.tool_use_id ?? raw.call_id ?? payload.timestamp ?? raw.captureDeliveryId
    return createHash('sha256').update(JSON.stringify([payload.source, payload.sessionId ?? payload.terminalId,
      payload.event, identity ?? payload.message ?? 'status'])).digest('hex')
  }

  private resolveTerminal(payload: AgentHookPayload): TerminalContext | null {
    if (payload.terminalId) {
      const terminal = this.terminals.get(payload.terminalId)
      return terminal?.engine === payload.source ? terminal : null
    }

    const sameEngine = Array.from(this.terminals.values()).filter(
      (terminal) => terminal.engine === payload.source,
    )
    if (sameEngine.length === 0) return null

    const workspaceMatches = payload.workspaceId
      ? sameEngine.filter((terminal) => terminal.workspaceId === payload.workspaceId)
      : []
    if (workspaceMatches.length === 1) return workspaceMatches[0]

    const payloadCwd = normalizePath(payload.cwd)
    const cwdSource = workspaceMatches.length > 0 ? workspaceMatches : sameEngine
    const cwdMatches = payloadCwd
      ? cwdSource.filter((terminal) => normalizePath(terminal.cwd) === payloadCwd)
      : []
    if (cwdMatches.length === 1) return cwdMatches[0]

    return sameEngine.length === 1 ? sameEngine[0] : null
  }

  private async recordHookPayload(payload: AgentHookPayload, epoch: number, semantic?: AgentHookSemantic): Promise<void> {
    if (!semantic || !await this.isCurrent(epoch)) return
    const terminal = this.resolveTerminal(payload)
    if (!terminal?.cwd) return
    if (semantic.type === 'turn-start') await this.recordStart(payload, terminal, epoch, semantic.resume)
    else if (semantic.type === 'waiting-user') await this.recordAttention(payload, terminal, epoch)
    else if (semantic.type === 'turn-end') await this.recordEnd(payload, terminal, semantic.kind, epoch)
    else if (semantic.type === 'session-close' && semantic.interruptedTurn) await this.recordEnd(payload, terminal, 'interrupted', epoch)
  }

  private async recordStart(
    payload: AgentHookPayload,
    terminal: TerminalContext,
    epoch: number,
    resume = false,
  ): Promise<void> {
    const metadata = payload.raw && typeof payload.raw === 'object' ? payload.raw as Record<string, unknown> : {}
    if (payload.event === 'UserPromptSubmit' && (isRuntimeNotification(payload.message ?? '') || payload.source === 'claude' && metadata.isMeta === true)) {
      this.emit({ type: 'skipped', reason: 'runtime-notification', terminalId: terminal.terminalId,
        engine: terminal.engine, hookEvent: payload.event, workspaceId: terminal.workspaceId, workspacePath: terminal.cwd })
      return
    }
    const activeTurn = this.activeTurns.get(terminal.terminalId)
    const promptHash = hasText(payload.message) ? createHash('sha256').update(payload.message).digest('hex') : undefined
    const eventId = this.eventId(payload)
    if (
      activeTurn && !resume &&
      (!hasText(payload.message) ||
        (payload.sessionId === activeTurn.sessionId && promptHash === activeTurn.promptHash && eventId === activeTurn.id))
    ) {
      return
    }

    const now = timestampToMs(payload.timestamp) ?? Date.now()
    const startedAt = new Date(now).toISOString()
    const turn: ActiveTurn = resume && activeTurn ? activeTurn : {
      id: eventId,
      terminalId: terminal.terminalId,
      engine: terminal.engine,
      workspaceId: terminal.workspaceId,
      workspacePath: terminal.cwd,
      prompt: payload.event === 'UserPromptSubmit' && payload.message ? redactHighConfidenceSecrets(payload.message).text : undefined,
      promptHash,
      sessionId: payload.sessionId,
      startedAt,
      startedAtMs: now,
    }
    this.activeTurns.set(terminal.terminalId, turn)

    // Only an actual prompt-submission hook carries the user's words. Status messages do not.
    const userPrompt = payload.event === 'UserPromptSubmit' && hasText(payload.message)
    const sourceEventId = eventId

    if (!await this.isCurrent(epoch)) return
    const [observation] = await knowledgeCaptureInbox.submit([{ input: {
      workspaceId: terminal.workspaceId,
      workspacePath: terminal.cwd,
      source: 'agent-stream',
      type: hasText(payload.message) ? 'conversation-turn' : 'system-event',
      content: hasText(payload.message)
        ? redactHighConfidenceSecrets(payload.message).text
        : `${terminal.engine} terminal task started`,
      summary: `${terminal.engine} terminal task started`,
      tags: ['terminal-hook', resume && activeTurn ? 'turn-input' : 'turn-started', terminal.engine],
      actor: userPrompt ? 'user' : terminal.engine,
      correlationId: turn.id,
      sessionId: payload.sessionId,
      agentId: terminal.engine,
      metadata: {
        terminalId: terminal.terminalId,
        engine: terminal.engine,
        hookEvent: payload.event,
        sessionId: payload.sessionId,
        startedAt,
      },
    }, context: { speaker: userPrompt ? 'user' : 'unknown', sourceEventId, createdAt: startedAt } }], () => this.isCurrent(epoch))
    if (!observation || !await this.isCurrent(epoch)) return
    turn.observationId ??= observation.id
    this.emitCaptured(payload, terminal, observation.id)
  }

  private async recordAttention(
    payload: AgentHookPayload,
    terminal: TerminalContext,
    epoch: number,
  ): Promise<void> {
    const activeTurn = this.activeTurns.get(terminal.terminalId)
    if (!await this.isCurrent(epoch)) return
    const [observation] = await knowledgeCaptureInbox.submit([{ input: {
      workspaceId: terminal.workspaceId,
      workspacePath: terminal.cwd,
      source: 'agent-stream',
      type: 'system-event',
      content: payload.message?.trim() || `${terminal.engine} terminal needs attention`,
      summary: `${terminal.engine} terminal attention`,
      tags: ['terminal-hook', 'turn-attention', terminal.engine],
      actor: terminal.engine,
      correlationId: activeTurn?.id ?? `terminal:${terminal.terminalId}`,
      sessionId: payload.sessionId ?? activeTurn?.sessionId,
      agentId: terminal.engine,
      metadata: {
        terminalId: terminal.terminalId,
        engine: terminal.engine,
        hookEvent: payload.event,
        sessionId: payload.sessionId,
      },
    }, context: { speaker: 'system', sourceEventId: this.eventId(payload) } }], () => this.isCurrent(epoch))
    if (observation && await this.isCurrent(epoch)) this.emitCaptured(payload, terminal, observation.id)
  }

  private async recordEnd(
    payload: AgentHookPayload,
    terminal: TerminalContext,
    kind: AgentHookCompletionKind,
    epoch: number,
  ): Promise<void> {
    const failed = kind === 'failed'
    let activeTurn = this.activeTurns.get(terminal.terminalId)
    if (payload.sessionId && activeTurn?.sessionId !== payload.sessionId) activeTurn = undefined
    if (!activeTurn && payload.sessionId) {
      const sessionRows = (await knowledgeObservationService.listAll(true)).filter(row => row.workspaceId === terminal.workspaceId
        && row.sessionId === payload.sessionId && row.agentId === terminal.engine)
      const eventId = this.eventId(payload)
      const replay = sessionRows.find(row => row.sourceEvidence?.sourceEventId === `${eventId}:transcript-complete`)
      if (replay) { this.emitCaptured(payload, terminal, replay.id); return }
      const closed = new Set(sessionRows.filter(row => (row.tags.includes('turn-completed') || row.tags.includes('turn-failed') || row.tags.includes('turn-interrupted'))
        && ![eventId, `${eventId}:transcript-pending`].includes(row.sourceEvidence?.sourceEventId ?? '')).map(row => row.correlationId))
      const starts = sessionRows.filter(row => row.tags.includes('turn-started') && !closed.has(row.correlationId)
        && Date.parse(row.createdAt) <= (timestampToMs(payload.timestamp) ?? Date.now()))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      for (const start of starts) {
        const prompt = start.sourceEvidence?.speaker === 'user' ? await knowledgeObservationService.resolveContent(start) : undefined
        if (!start.correlationId || prompt && isRuntimeNotification(prompt)) continue
        activeTurn = { id: start.correlationId, observationId: start.id, terminalId: terminal.terminalId, engine: terminal.engine,
          workspaceId: terminal.workspaceId, workspacePath: terminal.cwd, prompt,
          sessionId: payload.sessionId, startedAt: start.createdAt, startedAtMs: Date.parse(start.createdAt) }
        break
      }
    }
    const endedAtMs = timestampToMs(payload.timestamp) ?? Date.now()
    const durationMs = activeTurn ? endedAtMs - activeTurn.startedAtMs : undefined
    const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw as Record<string, unknown> : {}
    const transcriptPath = raw.transcript_path ?? raw.transcriptPath ?? (terminal.engine === 'opencode' && (payload.sessionId ?? activeTurn?.sessionId) ? resolveOpencodeDbPath() : undefined)
    const correlationId = activeTurn?.id ?? this.eventId(payload)
    const end: CaptureEntry = { input: {
      workspaceId: terminal.workspaceId,
      workspacePath: terminal.cwd,
      source: 'agent-stream',
      type: 'system-event',
      content: `Terminal turn ${kind === 'done' ? 'completed' : kind}`,
      summary: `${terminal.engine} terminal task ${kind === 'done' ? 'completed' : kind}`,
      tags: ['terminal-hook', failed ? 'turn-failed' : kind === 'interrupted' ? 'turn-interrupted' : 'turn-completed', terminal.engine],
      actor: terminal.engine,
      correlationId,
      sessionId: payload.sessionId ?? activeTurn?.sessionId,
      agentId: terminal.engine,
      metadata: {
        terminalId: terminal.terminalId,
        engine: terminal.engine,
        hookEvent: payload.event,
        sessionId: payload.sessionId ?? activeTurn?.sessionId,
        startedAt: activeTurn?.startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs,
        failed,
        completionKind: kind,
        prompt: activeTurn?.prompt,
        evidenceStatus: failed ? 'turn-failed' : 'transcript-path-unavailable',
      },
    }, context: { speaker: 'unknown', sourceEventId: this.eventId(payload), createdAt: new Date(endedAtMs).toISOString(),
      relatedObservationIds: activeTurn?.observationId ? [activeTurn.observationId] : undefined } }
    if (!await this.isCurrent(epoch)) return
    const observations = kind === 'done' && typeof transcriptPath === 'string'
      ? await knowledgeTranscriptRecovery.submit({ end, path: transcriptPath, engine: terminal.engine, prompt: activeTurn?.prompt }, () => this.isCurrent(epoch))
      : await knowledgeCaptureInbox.submit([end], () => this.isCurrent(epoch))
    const observation = observations[observations.length - 1]!
    if (!await this.isCurrent(epoch)) return
    this.activeTurns.delete(terminal.terminalId)
    if (!observation) return // A revoked parent cancels the persisted reread.
    // Phase 5 (§6 gap close): the turn ended — bypass the capture debounce so
    // deterministic sedimentation runs promptly for this workspace.
    knowledgeProcessingQueue.scheduleImmediate(
      observation?.workspaceId ?? terminal.workspaceId ?? '',
    )
    this.emitCaptured(payload, terminal, observation.id)
  }

  private emitCaptured(
    payload: AgentHookPayload,
    terminal: TerminalContext,
    observationId: string,
  ): void {
    this.emit({
      type: 'captured',
      terminalId: terminal.terminalId,
      engine: terminal.engine,
      hookEvent: payload.event,
      workspaceId: terminal.workspaceId,
      workspacePath: terminal.cwd,
      observationId,
    })
  }

  private emit(event: AgentTurnRecorderEvent): void {
    this.eventSink?.(event)
  }
}

export const agentTurnRecorder = new AgentTurnRecorder()
