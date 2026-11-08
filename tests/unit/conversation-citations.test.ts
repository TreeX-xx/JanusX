import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { conversationCitationMarkdown } from '../../src/renderer/src/lib/conversation-citations'
import { conversationLink } from '../../src/renderer/src/lib/conversation-link'

function links(markdown: string) {
  const result: Array<{ url: string; title?: string | null; label: string }> = []
  function visit(node: Nodes) {
    if (node.type === 'link') result.push({ url: node.url, title: node.title, label: node.children.map(child => 'value' in child ? child.value : '').join('') })
    if ('children' in node) node.children.forEach(visit)
  }
  visit(fromMarkdown(markdown))
  return result
}

describe('conversation file citations', () => {
  it.each([
    'C:/work/a [draft] #1?.ts',
    'C:\\Users\\Tree\\source.ts',
    '/home/tree/中文 & notes.ts',
    '//server/share/source.ts',
    'src/source.ts',
  ])('keeps the exact path and safely renders %s', path => {
    const raw = `See :codex-file-citation{path=${JSON.stringify(path)} purpose="source"}.`
    const rendered = links(conversationCitationMarkdown(raw))
    expect(rendered).toHaveLength(1)
    expect(rendered[0].title).toBe(path)
    expect(rendered[0].label).toBe(path.split(/[\\/]/).pop())
    const target = conversationLink(rendered[0].url, 'C:/work')
    expect(target).toEqual({ filePath: path.startsWith('src/') ? 'C:/work/' + path : path.replace(/\\/g, '/') })
  })

  it('leaves fenced/inline code, existing links, escaped markers and HTML untouched', () => {
    const marker = ':codex-file-citation{path="C:/work/a.ts" purpose="source"}'
    const text = `\`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`\n\n[${marker}](https://example.com)\n\n\\${marker}\n\n<!-- ${marker} -->`
    expect(conversationCitationMarkdown(text, true)).toBe(text)
  })

  it('does not hide incomplete code examples during streaming', () => {
    for (const text of ['```\n:codex-file-citation{path="C:/work', '`example :codex-file-citation{path="C:/work`']) {
      expect(conversationCitationMarkdown(text, true)).toBe(text)
    }
  })

  it('hides only a trailing in-progress marker and restores unfinished output when settled', () => {
    for (const tail of [':codex', ':codex-file-cit', ':codex-file-citation{path="C:/work/a.ts" purpose="source"', ':codex-file-citation{path="C:/work/a}b.ts']) {
      expect(conversationCitationMarkdown('See ' + tail, true)).toBe('See ')
      expect(conversationCitationMarkdown('See ' + tail)).toBe('See ' + tail)
    }
    expect(conversationCitationMarkdown('Ordinary :code text', true)).toBe('Ordinary :code text')
  })

  it('keeps unsupported or malformed targets literal without creating executable links', () => {
    for (const attributes of ['path="javascript:alert(1)"', 'path="https://example.com"', 'purpose="source"', 'path=""', 'path="C:/a.ts" path="C:/b.ts"', 'path="C:/a.ts" nonsense']) {
      const text = `:codex-file-citation{${attributes}}`
      expect(conversationCitationMarkdown(text)).toBe(text)
    }
  })
})
