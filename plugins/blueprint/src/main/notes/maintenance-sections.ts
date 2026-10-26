import { readMarkdownView } from '@janus-agent/harness-core'

/** Section edits are H2 slices; the shared parser owns Markdown syntax. A
 * null value is an internal inverse operation, never accepted from a model. */
export function editMaintenanceSections(body: string, edits: Record<string, string | null>): {
  body: string; before: Record<string, string | null>
} {
  const before: Record<string, string | null> = Object.create(null)
  for (const [name, text] of Object.entries(edits)) {
    if (!name.trim() || /[\r\n]/.test(name)) throw new Error('Invalid section heading')
    const lines = body.replace(/\r\n/g, '\n').split('\n')
    const headings = readMarkdownView(body).headings
    const matches = headings.filter(heading => heading.depth === 2 && heading.text === name)
    if (matches.length > 1) throw new Error(`Ambiguous section heading: ${name}`)
    const heading = matches[0]
    if (!heading) {
      before[name] = null
      if (text !== null) body = body.replace(/\s*$/, '') + `\n\n## ${name}\n\n${text}\n`
      continue
    }
    const start = heading.line - 1
    // The public editor contract uses ATX sections. Refuse other forms rather
    // than silently consuming a setext underline or a nested block heading.
    if (!/^ {0,3}##[\t ]/.test(lines[start])) throw new Error(`Unsupported section heading: ${name}`)
    const end = headings.find(next => next.line > heading.line && next.depth <= 2)?.line ?? lines.length + 1
    const content = lines.slice(start + 1, end - 1)
    while (content.length && !content[0].trim()) content.shift()
    while (content.length && !content.at(-1)!.trim()) content.pop()
    before[name] = content.join('\n')
    lines.splice(start, end - 1 - start, ...(text === null ? [] : [lines[start], '', text, '']))
    body = lines.join('\n')
  }
  return { body, before }
}
