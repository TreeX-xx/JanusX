// Note: concise causes retain the original error in details — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
export function reviewErrorKey(error: string) {
  if (/Structure check failed/.test(error)) return 'review.failure.structure' as const
  if (/source operation/i.test(error)) return 'review.failure.sourceOperation' as const
  if (/timed? ?out|timeout/i.test(error)) return 'review.failure.timeout' as const
  if (/cancel|interrupted/i.test(error)) return 'review.failure.cancelled' as const
  return 'review.failure.unknown' as const
}
