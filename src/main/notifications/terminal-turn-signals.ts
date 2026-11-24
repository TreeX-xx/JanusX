export function isTerminalInterrupt(data: string): boolean {
  return data === '\x03'
}

// Codex writes OSC 7501 lifecycle controls separately from the visible text.
// Note: .agents/notes/terminal/terminal-hook-launch-isolation.md
export class CodexTerminalSignals {
  private tail = ''
  private working = false
  interruptRequested = false

  endTurn(): void {
    this.working = false
    this.interruptRequested = false
    this.tail = ''
  }

  push(data: string, end: (kind: 'api-error' | 'interrupted') => void): void {
    const previous = this.tail.length
    const chunk = this.tail + data
    // Keep enough bytes for a split control, never reprocess a complete one.
    this.tail = chunk.slice(-48)
    for (const match of chunk.matchAll(/\x1b\]7501;state=(working|idle|error|done):app=codex(?:\x07|\x1b\\)/g)) {
      if (match.index + match[0].length <= previous) continue
      const state = match[1]
      if (state === 'working') {
        this.working = true
        continue
      }
      const wasWorking = this.working
      const interrupted = this.interruptRequested
      this.working = false
      this.interruptRequested = false
      if (wasWorking && state === 'error') end('api-error')
      if (wasWorking && interrupted && state === 'idle') end('interrupted')
    }
  }
}
