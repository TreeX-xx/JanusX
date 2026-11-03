import type { KeyboardEvent } from 'react'

/** Keep Ctrl+J local to text entry, including selection replacement and IME. */
export function insertConversationNewline(event: KeyboardEvent, update: (value: string) => void): boolean {
  const input = event.target
  if (!(input instanceof HTMLTextAreaElement) || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
    || event.key.toLowerCase() !== 'j' || event.nativeEvent.isComposing || event.keyCode === 229 || input.readOnly || input.disabled) return false
  event.preventDefault(); event.stopPropagation()
  const start = input.selectionStart
  const value = `${input.value.slice(0, start)}\n${input.value.slice(input.selectionEnd)}`
  if (input.maxLength >= 0 && value.length > input.maxLength) return true
  update(value)
  requestAnimationFrame(() => { if (input.isConnected) input.setSelectionRange(start + 1, start + 1) })
  return true
}
