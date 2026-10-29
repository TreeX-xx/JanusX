import { normalizeHookLifecycle } from '../notifications/agent-hook-lifecycle'
import {
  type AgentHookSemantic,
  type AgentHookPayload,
} from '../notifications/agent-hook-types'

export type CompanionEngine = 'claude' | 'codex' | 'opencode' | 'janus' | 'pi' | 'dsh'

export interface CompanionTerminalMetadata {
  terminalId: string
  engine: CompanionEngine
  workspaceId: string
  cwd: string
}

export class CompanionSessionState {
  private readonly terminals = new Map<string, CompanionTerminalMetadata>()
  private readonly pendingApprovals = new Set<string>()

  registerTerminal(metadata: CompanionTerminalMetadata): void {
    this.terminals.set(metadata.terminalId, metadata)
  }

  unregisterTerminal(terminalId: string): void {
    this.terminals.delete(terminalId)
    this.pendingApprovals.delete(terminalId)
  }

  getTerminal(terminalId: string): CompanionTerminalMetadata | undefined {
    return this.terminals.get(terminalId)
  }

  listTerminals(): CompanionTerminalMetadata[] {
    return [...this.terminals.values()]
  }

  setPendingApproval(terminalId: string): void {
    if (this.terminals.has(terminalId)) this.pendingApprovals.add(terminalId)
  }

  clearPendingApproval(terminalId: string): void {
    this.pendingApprovals.delete(terminalId)
  }

  hasPendingApproval(terminalId: string): boolean {
    return this.pendingApprovals.has(terminalId)
  }

  handleHookPayload(payload: AgentHookPayload): void {
    const semantic = normalizeHookLifecycle(payload)
    if (payload.terminalId && semantic) this.handleLifecycle(payload.terminalId, semantic)
  }

  handleLifecycle(terminalId: string, semantic: AgentHookSemantic): void {
    if (semantic.type === 'waiting-user') {
      if (semantic.kind === 'approval') this.setPendingApproval(terminalId)
      else this.clearPendingApproval(terminalId)
    } else if (semantic.type !== 'session-update') this.clearPendingApproval(terminalId)
  }

  clear(): void {
    this.terminals.clear()
    this.pendingApprovals.clear()
  }
}

export const companionSessionState = new CompanionSessionState()
