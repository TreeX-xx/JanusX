import { describe, expect, it } from 'vitest'
import {
  createTerminalColorQueryResponder,
  isDefaultColorQuery,
} from '../../src/shared/terminalColorQuery'

describe('terminal color query responder', () => {
  // 无参 responder 走默认主题（经典黑）
  it('answers Codex foreground and background queries in order', () => {
    const responder = createTerminalColorQueryResponder()

    expect(responder.push('\x1b]10;?\x1b\\\x1b]11;?\x1b\\')).toBe(
      '\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\' +
      '\x1b]11;rgb:1515/1515/1717\x1b\\',
    )
  })

  it('recognizes queries split across arbitrary PTY chunks', () => {
    const responder = createTerminalColorQueryResponder()

    expect(responder.push('prompt\x1b]1')).toBe('')
    expect(responder.push('0;?\x1b')).toBe('')
    expect(responder.push('\\next')).toBe('\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\')
  })

  it('supports BEL terminators and ignores color assignments', () => {
    const responder = createTerminalColorQueryResponder()

    expect(responder.push('\x1b]11;?\x07')).toBe('\x1b]11;rgb:1515/1515/1717\x1b\\')
    expect(responder.push('\x1b]10;#ffffff\x1b\\')).toBe('')
  })

  it('only suppresses renderer handling for actual queries', () => {
    expect(isDefaultColorQuery('?')).toBe(true)
    expect(isDefaultColorQuery('#ffffff')).toBe(false)
    expect(isDefaultColorQuery('rgb:ffff/ffff/ffff')).toBe(false)
  })
})
