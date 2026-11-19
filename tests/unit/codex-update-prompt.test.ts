import { expect, it, vi } from 'vitest'
import { DesktopCodexConversation } from '../../src/main/terminal/codex-conversation'
import type { CodexUpdateCommand } from '../../src/shared/conversation-display'

it.each([['update', '1'], ['skip', '2'], ['dismiss', '3']] as const)(
  'forwards %s once for the active conversation prompt', async (choice, key) => {
    const session = new DesktopCodexConversation('update-menu', vi.fn())
    const write = vi.fn()
    try {
      await session.command({ type: 'mode', mode: 'conversation' })
      session.observeStartupOutput('Update available · 0.169.0 → 0.170.0\r\n1. Update\x1b[10;24Hnow  2. Skip\r\n3. Skip until')
      expect(session.snapshot().codexUpdatePrompt).toBeUndefined()
      session.observeStartupOutput(' next version')
      const prompt = session.snapshot().codexUpdatePrompt!
      expect(prompt.versions).toEqual({ current: '0.169.0', latest: '0.170.0' })
      const command: CodexUpdateCommand = { type: 'codexUpdate', choice, promptId: prompt.id, controlEpoch: session.state.controlEpoch }
      expect(session.acceptsTerminalInput('1')).toBe(false)
      expect(() => session.chooseUpdate({ ...command, promptId: 'old' }, write)).toThrow()
      expect(() => session.chooseUpdate({ ...command, controlEpoch: -1 }, write)).toThrow()
      expect(session.chooseUpdate(command, write).codexUpdatePrompt?.choice).toBe(choice)
      expect(() => session.chooseUpdate(command, write)).toThrow()
      session.state.connection = 'ready'
      expect(session.snapshot().codexUpdatePrompt).toBeUndefined()
      expect(() => session.chooseUpdate(command, write)).toThrow()
      expect(write.mock.calls).toEqual([[key]])
    } finally {
      await session.dispose()
    }
  },
)
