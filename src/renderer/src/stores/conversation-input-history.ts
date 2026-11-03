// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface InputHistoryEntry { text: string; time: number }
export const inputHistoryScope = (workspace: string, cwd: string, engine: string) => JSON.stringify([workspace, cwd, engine])
export const useConversationInputHistory = create<{ entries: Record<string, InputHistoryEntry[]> }>()(persist(() => ({ entries: {} }), {
  name: 'janusx-conversation-input-history',
  version: 1,
  storage: createJSONStorage(() => ({
    getItem: name => localStorage.getItem(name),
    // History is best effort; quota/storage failures must never interrupt sending.
    setItem: (name, value) => { try { localStorage.setItem(name, value) } catch { /* Keep in-memory history. */ } },
    removeItem: name => { try { localStorage.removeItem(name) } catch { /* Storage may be unavailable. */ } },
  })),
}))

export function rememberConversationInput(scope: string, text: string): void {
  if (!text.trim() || text.length > 32000) return
  useConversationInputHistory.setState(state => {
    const previous = state.entries[scope] ?? []
    if (previous.at(-1)?.text === text) return state
    const entries = { ...state.entries, [scope]: [...previous, { text, time: Date.now() }].slice(-200) }
    // Bound total storage as well as each scope; keep the most recently used scopes.
    const recent = Object.entries(entries).sort((a, b) => (b[1].at(-1)?.time ?? 0) - (a[1].at(-1)?.time ?? 0)).slice(0, 30)
    let budget = 500_000
    return { entries: Object.fromEntries(recent.map(([key, rows]) => {
      const kept: InputHistoryEntry[] = []
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].text.length > budget) break
        budget -= rows[i].text.length; kept.unshift(rows[i])
      }
      return [key, kept]
    })) }
  })
}

export function mergeInputHistory(local: InputHistoryEntry[], native: InputHistoryEntry[]): string[] {
  const seen = new Set<string>()
  return [...local, ...native].sort((a, b) => b.time - a.time).filter(row => {
    if (seen.has(row.text)) return false
    seen.add(row.text); return true
  }).slice(0, 200).reverse().map(row => row.text)
}

/** A browsing snapshot keeps incoming turns from shifting the cursor. */
export class InputHistoryCursor {
  private rows: string[] = []
  private index = 0
  private draft = ''
  private recalled: string | null = null
  reset(): void { this.recalled = null; this.rows = [] }
  move(key: string, value: string, start: number, end: number, history: string[]): string | undefined {
    if (this.recalled !== null && value !== this.recalled) this.reset()
    if (start !== end) return
    if (key === 'ArrowUp') {
      if (value.slice(0, start).includes('\n')) return
      if (this.recalled === null) {
        if (!history.length) return
        this.rows = [...history]; this.index = this.rows.length; this.draft = value
      }
      this.index = Math.max(0, this.index - 1)
    } else if (key === 'ArrowDown') {
      if (this.recalled === null || value.slice(end).includes('\n')) return
      this.index++
      if (this.index >= this.rows.length) { const draft = this.draft; this.reset(); return draft }
    } else return
    return this.recalled = this.rows[this.index]
  }
}
