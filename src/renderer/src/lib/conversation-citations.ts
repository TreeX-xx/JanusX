import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

// Display contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
const marker = ':codex-file-citation'
const directive = /:codex-file-citation\{((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^{}"'])*)\}/g

function citationPath(attributes: string): string | null {
  const pattern = /\s*([\w-]+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*/gy
  const values = new Map<string, string>()
  while (pattern.lastIndex < attributes.length) {
    const match = pattern.exec(attributes)
    if (!match || values.has(match[1])) return null
    values.set(match[1], match[2].slice(1, -1).replace(/\\(["'\\])/g, '$1'))
  }
  const path = values.get('path')
  if (!path || !path.trim() || /[\u0000-\u001f]/.test(path)) return null
  if (/^[\w+.-]+:/.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null
  return path
}

function fileLink(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/').replace(/^([a-z])%3A\//i, '$1:/')
  const href = /^[a-z]:\//i.test(normalized) ? `file:///${encoded}`
    : normalized.startsWith('//') ? `file:${encoded}`
      : normalized.startsWith('/') ? `file://${encoded}` : encoded
  const name = normalized.replace(/\/+$/, '').split('/').pop() || path
  const label = name.replace(/&/g, '&amp;').replace(/[\\`*_[\]<>]/g, '\\$&')
  return `[${label}](<${href}> ${JSON.stringify(path)})`
}

/** Preserve source bytes until rendering, including paths with Markdown syntax.
 * AST offsets protect code, HTML and existing links from text substitution.
 * Only responses containing the directive pay for the extra Markdown parse.
 */
export function conversationCitationMarkdown(content: string, streaming = false): string {
  if (!content.includes(':codex')) return content
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
  const changes: Array<{ start: number; end: number; text: string }> = []
  for (const match of content.matchAll(directive)) {
    if (literal(match.index!)) continue
    const path = citationPath(match[1])
    if (path) changes.push({ start: match.index!, end: match.index! + match[0].length, text: fileLink(path) })
  }
  if (streaming) {
    const start = content.lastIndexOf(':codex')
    const tail = content.slice(start)
    const complete = tail.matchAll(directive).next().value?.index === 0
    if (start >= 0 && !literal(start) && (marker.startsWith(tail) || tail.startsWith(marker + '{') && !complete)) {
      changes.push({ start, end: content.length, text: '' })
    }
  }
  // Apply backwards so source offsets remain valid and original text is intact.
  let result = content
  for (const change of changes.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.text + result.slice(change.end)
  return result
}
