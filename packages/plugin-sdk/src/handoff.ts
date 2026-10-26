import { z } from 'zod'

/** A reviewed terminal draft is text, never a command, shell argument, escape sequence or automatic submission. */
export const terminalDraftSchema = z.object({
  text: z.string().min(1).max(32_000).refine(value => value.trim().length > 0
    && Array.from(value).every(character => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && (code < 127 || code > 159))
    })),
}).strict()
