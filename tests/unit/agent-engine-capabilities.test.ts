import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_ENGINE_CAPABILITIES,
  extractHookRawStatus,
  matchesEngineEvents,
  normalizeHookEventName,
  resolveSessionStorePath,
} from '../../src/main/notifications/agent-engine-capabilities'
import type { AgentHookSource } from '../../src/main/notifications/agent-hook-types'

const NATIVE: AgentHookSource[] = ['claude', 'codex', 'janus', 'pi']

describe('agent engine capabilities', () => {
  it('covers every hook source with a transcript and sentinel contract', () => {
    const sources: AgentHookSource[] = ['claude', 'codex', 'opencode', 'janus', 'pi']
    for (const source of sources) {
      const capability = AGENT_ENGINE_CAPABILITIES[source]
      expect(capability, source).toBeTruthy()
      expect(capability.start.length).toBeGreaterThan(0)
      expect(capability.complete.length).toBeGreaterThan(0)
    }
    expect(AGENT_ENGINE_CAPABILITIES.claude.transcript).toBe('claude-jsonl')
    expect(AGENT_ENGINE_CAPABILITIES.codex.transcript).toBe('codex-rollout')
    expect(AGENT_ENGINE_CAPABILITIES.janus.transcript).toBe('janus-history')
    expect(AGENT_ENGINE_CAPABILITIES.opencode.transcript).toBeNull()
    expect(AGENT_ENGINE_CAPABILITIES.pi.transcript).toBeNull()
    expect(AGENT_ENGINE_CAPABILITIES.claude.sentinel).toBe(true)
    expect(AGENT_ENGINE_CAPABILITIES.codex.sentinel).toBe(true)
    for (const source of ['opencode', 'janus', 'pi'] as const) {
      expect(AGENT_ENGINE_CAPABILITIES[source].sentinel).toBe(false)
    }
    expect(AGENT_ENGINE_CAPABILITIES.claude.sessionStore).toBe('claude-projects')
    expect(AGENT_ENGINE_CAPABILITIES.codex.sessionStore).toBe('codex-sessions')
    expect(AGENT_ENGINE_CAPABILITIES.opencode.sessionStore).toBe('opencode-sqlite')
    expect(AGENT_ENGINE_CAPABILITIES.pi.sessionStore).toBe('pi-sessions')
    for (const source of ['janus'] as const) {
      expect(AGENT_ENGINE_CAPABILITIES[source].sessionStore).toBeNull()
    }
  })

  it('resolves session store paths from env with home fallbacks', () => {
    const home = resolve('home', 'user')
    expect(resolveSessionStorePath('claude', {}, home)).toBe(join(home, '.claude', 'projects'))
    expect(resolveSessionStorePath('codex', {}, home)).toBe(join(home, '.codex', 'sessions'))
    expect(
      resolveSessionStorePath('claude', { CLAUDE_CONFIG_DIR: '/opt/claude' }, home),
    ).toBe(join('/opt/claude', 'projects'))
    expect(resolveSessionStorePath('codex', { CODEX_HOME: '/opt/codex' }, home)).toBe(
      join('/opt/codex', 'sessions'),
    )
    expect(resolveSessionStorePath('claude', { CLAUDE_CONFIG_DIR: '  ' }, home)).toBe(
      join(home, '.claude', 'projects'),
    )
    expect(resolveSessionStorePath('janus', {}, home)).toBeNull()
    expect(resolveSessionStorePath('opencode', {}, home)).toBe(
      join(home, '.local', 'share', 'opencode', 'opencode.db'),
    )
    expect(resolveSessionStorePath('opencode', { XDG_DATA_HOME: '/custom-data' }, home)).toBe(
      join('/custom-data', 'opencode', 'opencode.db'),
    )
    expect(resolveSessionStorePath('opencode', { XDG_DATA_HOME: '/custom-data', OPENCODE_DB: 'alternate.db' }, home)).toBe(
      join('/custom-data', 'opencode', 'alternate.db'),
    )
    expect(resolveSessionStorePath('opencode', { OPENCODE_DB: join(process.cwd(), 'alternate.db') }, home)).toBe(
      join(process.cwd(), 'alternate.db'),
    )
    expect(resolveSessionStorePath('pi', {}, home)).toBe(join(home, '.pi', 'agent', 'sessions'))
  })

  it('classifies native turn events identically across hook-native engines', () => {
    for (const source of NATIVE) {
      expect(matchesEngineEvents(source, 'start', 'UserPromptSubmit')).toBe(true)
      expect(matchesEngineEvents(source, 'complete', 'Stop')).toBe(true)
      expect(matchesEngineEvents(source, 'fail', 'StopFailure')).toBe(true)
      expect(matchesEngineEvents(source, 'fail', 'PostToolUseFailure')).toBe(true)
      expect(matchesEngineEvents(source, 'approval', 'PermissionRequest')).toBe(true)
      expect(matchesEngineEvents(source, 'attention', 'PermissionRequest')).toBe(true)
      expect(matchesEngineEvents(source, 'attention', 'Notification')).toBe(true)
      expect(matchesEngineEvents(source, 'start', 'Stop')).toBe(false)
      expect(matchesEngineEvents(source, 'complete', 'session.idle')).toBe(false)
    }
  })

  it('gates opencode status events on the raw status payload', () => {
    const busy = { status: 'busy' }
    const running = { properties: { status: 'running' } }
    const idle = { status: 'idle' }
    expect(matchesEngineEvents('opencode', 'start', 'session.status', busy)).toBe(true)
    expect(matchesEngineEvents('opencode', 'start', 'session.status', running)).toBe(true)
    expect(matchesEngineEvents('opencode', 'start', 'session.status', idle)).toBe(false)
    expect(matchesEngineEvents('opencode', 'start', 'session.status')).toBe(false)
    expect(matchesEngineEvents('opencode', 'start', 'session.status', {
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    })).toBe(true)
    expect(matchesEngineEvents('opencode', 'start', 'session.status', {
      properties: { status: { type: 'retry', message: 'server busy' } },
    })).toBe(false)
    expect(matchesEngineEvents('opencode', 'complete', 'session.idle')).toBe(true)
    expect(matchesEngineEvents('opencode', 'fail', 'session.error')).toBe(true)
    expect(matchesEngineEvents('opencode', 'approval', 'permission.asked')).toBe(true)
    expect(matchesEngineEvents('opencode', 'attention', 'permission.asked')).toBe(true)
    expect(matchesEngineEvents('opencode', 'attention', 'Notification')).toBe(false)
  })

  it('normalizes event names and extracts raw statuses like the old locals', () => {
    expect(normalizeHookEventName('opencode', '  session.status  ')).toBe('  session.status  ')
    expect(normalizeHookEventName('claude', '  Stop  ')).toBe('Stop')
    expect(extractHookRawStatus({ status: 'busy' })).toBe('busy')
    expect(extractHookRawStatus({ state: 'running' })).toBe('running')
    expect(extractHookRawStatus({ properties: { status: 'idle' } })).toBe('idle')
    expect(extractHookRawStatus({ properties: { status: { type: 'busy' } } })).toBe('busy')
    expect(extractHookRawStatus({})).toBeUndefined()
    expect(extractHookRawStatus(null)).toBeUndefined()
  })
})
