import type { ConversationSnapshot } from '../../../shared/conversation-display'
import type { SideChatSource } from '../stores/conversation-side-chat'

export function recentSideChatSource(items: ConversationSnapshot['items'], labels: { user: string; agent: string }): SideChatSource | undefined {
  const last = items.slice().reverse().find(item => item.text && (item.type === 'userMessage' || item.type === 'agentMessage'))
  if (!last) return
  const text = items.filter(item => item.turnId === last.turnId && (item.type === 'userMessage' || item.type === 'agentMessage') && item.text)
    .map(item => (item.type === 'userMessage' ? labels.user : labels.agent) + ': ' + item.text).join('\n\n')
  // Preserve both the original question and the most recent answer on long turns.
  return { kind: 'turn', turnId: last.turnId, itemId: last.id, text: text.length > 8000 ? text.slice(0, 2400) + '\n…\n' + text.slice(-5597) : text }
}

export function selectedSideChatSource(host: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  const common = range.commonAncestorContainer
  const element = common instanceof Element ? common : common.parentElement
  if (!element || !host.contains(element)) return
  const anchor = element.closest<HTMLElement>('[data-side-source], [data-conversation-input]')
  if (!anchor || !host.contains(anchor)) return
  const kind = anchor.hasAttribute('data-conversation-input') ? 'draft' : anchor.dataset.sideSource as SideChatSource['kind']
  let text = selection.toString()
  if (kind === 'diff') {
    const fragment = range.cloneContents()
    fragment.querySelectorAll('button').forEach(button => button.remove())
    text = fragment.textContent ?? ''
  }
  if (!text.trim()) return
  const rect = range.getClientRects()[0]
  if (!rect) return
  const bounds = host.parentElement!.getBoundingClientRect()
  const viewport = anchor.closest('[role="region"]')?.getBoundingClientRect() ?? host.getBoundingClientRect()
  if (rect.bottom < viewport.top || rect.top > viewport.bottom || rect.right < viewport.left || rect.left > viewport.right) return
  const source: SideChatSource = { kind, text, itemId: anchor.dataset.sideItem,
    turnId: anchor.dataset.sideTurn, path: anchor.dataset.sidePath }
  return { source, left: Math.max(6, Math.min(bounds.width - 158, rect.left - bounds.left)),
    top: Math.max(4, Math.min(bounds.height - 34, rect.top - bounds.top > 37 ? rect.top - bounds.top - 35 : rect.bottom - bounds.top + 4)) }
}
