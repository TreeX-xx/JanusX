import { describe, expect, it } from 'vitest'
import { CodexTerminalSignals, isTerminalInterrupt } from '../../src/main/notifications/terminal-turn-signals'

describe('terminal turn signals', () => {
  it('recognizes only a standalone Ctrl+C input as an interrupt', () => {
    expect(isTerminalInterrupt('\x03')).toBe(true)
    expect(isTerminalInterrupt('text\x03')).toBe(false)
    expect(isTerminalInterrupt('\x1b[200~\x03\x1b[201~')).toBe(false)
  })

  it('requires a live Codex control sequence for each failed turn, even across PTY chunks', () => {
    const signals = new CodexTerminalSignals()
    const output: string[] = []
    const feed = (text: string) => signals.push(text, kind => output.push(kind))
    const control = (state: string) => '\x1b]7501;state=' + state + ':app=codex\x1b\\'
    feed(control('error'))
    for (let turn = 0; turn < 2; turn++) {
      feed(control('working') + 'Request failed with status code 503')
      feed('7501;state=error:app=codex')
      for (const byte of control('error')) feed(byte)
      feed(control('error'))
    }
    expect(output).toEqual(['api-error', 'api-error'])
  })

  it('confirms a requested interrupt on native idle and drops the intent on completion', () => {
    const signals = new CodexTerminalSignals()
    const output: string[] = []
    const state = (name: string) => signals.push('\x1b]7501;state=' + name + ':app=codex\x07', kind => output.push(kind))
    state('working')
    state('idle')
    state('working')
    signals.interruptRequested = true
    state('done')
    state('idle')
    expect(output).toEqual([])
    state('working')
    signals.interruptRequested = true
    state('idle')
    expect(output).toEqual(['interrupted'])
  })
})
