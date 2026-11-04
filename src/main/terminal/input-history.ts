// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface NativeInputHistoryEntry { text: string; time: number }

/** Read only a bounded tail. Native history remains owned by the CLI. */
export async function readNativeInputHistory(engine: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<NativeInputHistoryEntry[]> {
  if (engine !== 'claude' && engine !== 'codex') return []
  const directory = engine === 'claude' ? env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') : env.CODEX_HOME || join(homedir(), '.codex')
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(join(directory, 'history.jsonl'), 'r')
    const size = (await file.stat()).size
    const start = Math.max(0, size - 1024 * 1024)
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
    if (start) lines.shift()
    return lines.flatMap(line => {
      try {
        const row = JSON.parse(line)
        let text = engine === 'claude' ? row.display : row.text
        if (typeof text !== 'string' || !text.trim() || text.length > 32000) return []
        if (engine === 'claude' && typeof text === 'string') {
          let length = text.length
          text = text.replace(/\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g, (placeholder: string, id: string) => {
            const paste = row.pastedContents?.[id]
            if (paste?.type !== 'text' || typeof paste.content !== 'string') return placeholder
            length += paste.content.length - placeholder.length
            if (length > 32000) throw new Error('Input exceeds composer limit')
            return paste.content
          })
        }
        const time = engine === 'claude' ? row.timestamp : row.ts * 1000
        if (typeof text !== 'string' || !text.trim() || text.length > 32000 || !Number.isFinite(time)) return []
        // Claude has project metadata; Codex's native input history is global.
        const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '')
        if (engine === 'claude' && (typeof row.project !== 'string' || normalize(row.project) !== normalize(cwd))) return []
        return [{ text, time }]
      } catch { return [] }
    }).slice(-200)
  } catch { return [] }
  finally { await file?.close().catch(() => {}) }
}
