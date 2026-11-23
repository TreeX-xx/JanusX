import { onTestFinished } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'

export function codexFixture(threadId: string | null = 'main', bind?: (threadId: string, transcriptPath?: string) => void) {
  const controller = new CodexConversation('test', () => {}, bind)
  onTestFinished(() => controller.dispose())
  // Drive the native protocol directly, without starting a provider process.
  const wire = controller as any
  if (threadId !== null) wire.attach({ id: threadId, turns: [] })

  function emit(method: string, params: object, id?: number | string) {
    wire.receive({ method, params: { threadId, ...params }, ...(id === undefined ? {} : { id }) })
  }
  return { controller, wire, emit }
}
