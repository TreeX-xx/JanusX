import { describe, expect, it } from 'vitest'
import { runtimeCapability } from '../../src/shared/runtime/capabilities'
import { supportsConversation } from '../../src/shared/conversation-display'
import { createShellProfileSeed } from '../../src/shared/shellProfiles'

describe('execution target capability contract', () => {
  it('distinguishes absent dependencies, failed probes and unknown targets', () => {
    expect(runtimeCapability('terminal', 'codex', { kind: 'local', platform: 'darwin' }, 'missing').status).toBe('missing-dependency')
    expect(runtimeCapability('terminal', 'codex', { kind: 'local', platform: 'darwin' }, 'failed').status).toBe('probe-error')
    expect(runtimeCapability('terminal', 'codex', { kind: 'ssh', platform: null }).reason).toBe('target-platform-unknown')
  })
  it('separates native Mac terminal display and verified managed Worker architectures', () => {
    const mac = { kind: 'local', platform: 'darwin' } as const
    expect(runtimeCapability('terminal', 'claude', mac, 'ready').status).toBe('available')
    expect(runtimeCapability('conversation', 'claude', mac).status).toBe('unsupported')
    expect(runtimeCapability('managed-worker', 'codex', mac).status).toBe('unsupported')
    expect(runtimeCapability('managed-worker', 'codex', { ...mac, architecture: 'arm64' }).status).toBe('available')
    expect(runtimeCapability('managed-worker', 'codex', { ...mac, architecture: 'x64' }).status).toBe('unsupported')
    expect(runtimeCapability('managed-worker', 'claude', { ...mac, architecture: 'arm64' }).status).toBe('available')
    expect(runtimeCapability('managed-worker', 'claude', { ...mac, architecture: 'x64' }).status).toBe('unsupported')
    expect(supportsConversation('claude', 'darwin')).toBe(false)
    expect(supportsConversation('claude', 'win32')).toBe(true)
    expect(createShellProfileSeed('darwin').command).toBe('/bin/zsh')
  })
  it('reads existing histories without a CLI while refusing absent readers', () => {
    const target = { kind: 'local', platform: 'darwin' } as const
    expect(runtimeCapability('history', 'pi', target, 'missing').status).toBe('available')
    expect(runtimeCapability('history', 'dsh', target).reason).toBe('history-reader-unavailable')
  })
  it('does not infer remote support from a supported desktop', () => {
    expect(runtimeCapability('conversation', 'codex', { kind: 'ssh', platform: 'linux' }).status).toBe('unsupported')
    expect(runtimeCapability('terminal', 'codex', { kind: 'ssh', platform: 'darwin' }).status).toBe('unsupported')
    expect(runtimeCapability('install', 'codex', { kind: 'ssh', platform: 'linux' }).status).toBe('available')
  })
})
