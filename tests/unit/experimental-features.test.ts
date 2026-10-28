import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPERIMENTAL_FEATURES,
  EXPERIMENTAL_CHANNELS,
  normalizeExperimentalFeatures,
} from '../../src/shared/ipc/experimental'

describe('experimental feature flags', () => {
  it('ignores retired session and memo controls in older configurations', () => {
    for (const value of [false, true, 1, 'true', null]) {
      expect(normalizeExperimentalFeatures({ sessions: value, memo: value })).toEqual(DEFAULT_EXPERIMENTAL_FEATURES)
      expect(normalizeExperimentalFeatures({ persona: true, sessions: value, memo: value })).toEqual({ ...DEFAULT_EXPERIMENTAL_FEATURES, persona: true })
    }
  })

  it('defaults remaining experimental entries to off', () => {
    expect(DEFAULT_EXPERIMENTAL_FEATURES).toEqual({
      blueprint: false,
      knowledge: false,
      roundtable: false,
      persona: false,
      remoteControl: false,
      teamCollab: false,
    })
  })

  it('exposes stable get/update channels', () => {
    expect(EXPERIMENTAL_CHANNELS.get).toBe('experimental:get')
    expect(EXPERIMENTAL_CHANNELS.update).toBe('experimental:update')
  })

  it('falls back to defaults for missing or malformed input', () => {
    for (const value of [undefined, null, 'yes', {}]) {
      expect(normalizeExperimentalFeatures(value)).toEqual(DEFAULT_EXPERIMENTAL_FEATURES)
    }
  })

  it.each(Object.keys(DEFAULT_EXPERIMENTAL_FEATURES))('keeps %s independent and accepts only true', key => {
    expect(normalizeExperimentalFeatures({ [key]: true })).toEqual({ ...DEFAULT_EXPERIMENTAL_FEATURES, [key]: true })
    for (const value of [false, 1, 'true', null]) {
      expect(normalizeExperimentalFeatures({ [key]: value })).toEqual(DEFAULT_EXPERIMENTAL_FEATURES)
    }
  })
})
