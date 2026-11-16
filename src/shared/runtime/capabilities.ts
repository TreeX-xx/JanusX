// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { supportsConversation } from '@janus-agent/janus-agent/superagent/contracts/conversation-display'
import type { RuntimeIdentity } from './contracts'

export type RuntimeFeature = 'terminal' | 'install' | 'history' | 'conversation' | 'managed-worker'
export type CapabilityResult = { status: 'available' | 'missing-dependency' | 'unsupported' | 'probe-error'; reason?: string; message?: string }
export type CapabilityTarget = Pick<RuntimeIdentity, 'kind' | 'platform'>
/** Availability policy only; real-device verification is recorded separately in Notes. */
export function runtimeCapability(feature: RuntimeFeature, engine: string, target: CapabilityTarget, dependency?: 'ready' | 'missing' | 'failed'): CapabilityResult {
  const unavailable = (reason: string): CapabilityResult => ({ status: 'unsupported', reason, message: `This execution target does not support ${feature} for ${engine} in this version.` })
  if (!['shell', 'claude', 'codex', 'opencode', 'pi', 'dsh', 'janus'].includes(engine)) return unavailable('unknown-engine')
  if (target.kind !== 'local' && (feature === 'conversation' || feature === 'managed-worker')) return unavailable('remote-mode-unavailable')
  if (!target.platform) return { status: 'probe-error', reason: 'target-platform-unknown', message: 'The execution target could not be identified. Check the connection and retry.' }
  if (target.kind !== 'local' && target.platform !== 'linux') return unavailable('remote-platform-unavailable')
  if (feature === 'conversation' && (!supportsConversation(engine) || engine === 'claude' && target.platform !== 'win32')) return unavailable('conversation-driver-unavailable')
  if (feature === 'managed-worker' && (target.platform !== 'win32' || !['claude', 'codex'].includes(engine))) return unavailable('managed-worker-driver-unavailable')
  if (feature === 'history' && ['shell', 'dsh'].includes(engine)) return unavailable('history-reader-unavailable')
  if (feature === 'install' && ['shell', 'janus'].includes(engine)) return unavailable('installer-unavailable')
  if (feature !== 'history' && dependency === 'missing') return { status: 'missing-dependency', reason: 'cli-missing', message: 'Install the CLI before starting this session.' }
  if (feature !== 'history' && dependency === 'failed') return { status: 'probe-error', reason: 'cli-probe-failed', message: 'CLI detection failed. Check its diagnostic details and retry.' }
  return { status: 'available' }
}
