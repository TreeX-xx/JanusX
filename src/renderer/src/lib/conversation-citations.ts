import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

// Display contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
const citationMarker = ':codex-file-citation'
const previewMarker = '\uE200visualize\uE202'
const directive = /:codex-file-citation\{((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^{}"'])*)\}|\uE200visualize\uE202([^\uE200\uE201\r\n]*)\uE201/g

export type ConversationReferenceKind = 'source' | 'preview'
export const isConversationPreviewFile = (path: string): boolean => /\.(?:html?|pdf|md|markdown)$/i.test(path)

function isFilePath(path: unknown): path is string {
  return typeof path === 'string' && Boolean(path.trim()) && !/[\u0000-\u001f\ud800-\udfff]/u.test(path)
    && (!/^[\w+.-]+:/.test(path) || /^[a-z]:[\\/]/i.test(path))
}

function citationLink(attributes: string): string | null {
  const pattern = /\s*([\w-]+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*/gy
  const values = new Map<string, string>()
  while (pattern.lastIndex < attributes.length) {
    const match = pattern.exec(attributes)
    if (!match || values.has(match[1])) return null
    values.set(match[1], match[2].slice(1, -1).replace(/\\(["'\\])/g, '$1'))
  }
  const path = values.get('path')
  return isFilePath(path) ? fileLink(path) : null
}

function fileLink(path: string, caption?: string): string {
  const normalized = path.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/').replace(/^([a-z])%3A\//i, '$1:/')
  const href = /^[a-z]:\//i.test(normalized) ? `file:///${encoded}`
    : normalized.startsWith('//') ? `file:${encoded}`
      : normalized.startsWith('/') ? `file://${encoded}` : encoded
  const name = caption || normalized.replace(/\/+$/, '').split('/').pop() || path
  const label = name.replace(/&/g, '&amp;').replace(/[\\`*_[\]<>]/g, '\\$&')
  return `[${label}](<${href}> ${JSON.stringify(path)})`
}

function previewLink(payload: string, actionLabel?: string): string | null {
  let data
  try { data = JSON.parse(payload) } catch { return null }
  const path = data?.path
  if (!isFilePath(path) || /^[\\/]{2}/.test(path) || !isConversationPreviewFile(path)) return null
  const title = typeof data.title === 'string' ? data.title.replace(/\s+/g, ' ').trim() : ''
  return fileLink(path, [actionLabel, title].filter(Boolean).join(' · '))
}

/** Preserve source bytes until rendering, including paths with Markdown syntax.
 * AST offsets protect code, HTML and existing links from text substitution.
 * Only responses containing the directive pay for the extra Markdown parse.
 */
export function conversationCitationMarkdown(content: string, streaming = false, previewLabel?: string, references?: Map<number, ConversationReferenceKind>): string {
  if (!content.includes(':codex') && !content.includes('\uE200')) return content
  const protectedRanges: Array<[number, number]> = []
  function visit(node: Nodes) {
    if (['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'definition', 'html'].includes(node.type)) {
      const start = node.position?.start.offset, end = node.position?.end.offset
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end])
      return
    }
    if ('children' in node) node.children.forEach(visit)
  }
  visit(fromMarkdown(content))
  const literal = (offset: number) => {
    if (protectedRanges.some(([start, end]) => offset >= start && offset < end)) return true
    let escapes = 0
    while (content[offset - escapes - 1] === '\\') escapes++
    return escapes % 2 === 1
  }
  const changes: Array<{ start: number; end: number; text: string; kind?: ConversationReferenceKind }> = []
  let lastCompleteEnd = 0
  for (const match of content.matchAll(directive)) {
    const end = match.index! + match[0].length
    lastCompleteEnd = end
    if (literal(match.index!)) continue
    const text = match[1] === undefined ? previewLink(match[2], previewLabel) : citationLink(match[1])
    if (text) changes.push({ start: match.index!, end, text, kind: match[1] === undefined ? 'preview' : 'source' })
  }
  if (streaming) {
    for (const [prefix, marker] of [['\uE200', previewMarker], [':codex', citationMarker]]) {
      const start = content.lastIndexOf(prefix)
      if (start < lastCompleteEnd || literal(start)) continue
      const tail = content.slice(start)
      if (marker === previewMarker && /[\r\n\uE201]/.test(tail)) continue
      if (marker.startsWith(tail) || tail.startsWith(marker + '{')) {
        changes.push({ start, end: content.length, text: '' })
        break
      }
    }
  }
  // Record link positions in the rendered Markdown without changing their URLs.
  let result = '', end = 0
  for (const change of changes) {
    result += content.slice(end, change.start)
    if (change.kind) references?.set(result.length, change.kind)
    result += change.text
    end = change.end
  }
  return result + content.slice(end)
}
