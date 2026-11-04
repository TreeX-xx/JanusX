import { describe, expect, it } from 'vitest'
import { conversationLink } from '../../src/renderer/src/lib/conversation-link'

describe('conversation links', () => {
  it('opens filesystem paths and strips source locations', () => {
    expect(conversationLink('report.md:12', 'C:/repo')).toEqual({ filePath: 'C:/repo/report.md' })
    expect(conversationLink('src/main.ts:12:3', 'C:/repo')).toEqual({ filePath: 'C:/repo/src/main.ts' })
    expect(conversationLink('/tmp/report.md#L12', 'C:/repo')).toEqual({ filePath: '/tmp/report.md' })
    expect(conversationLink('file:///C:/My%20Files/report.md')).toEqual({ filePath: 'C:/My Files/report.md' })
    expect(conversationLink('C:\\repo\\report.md:12')).toEqual({ filePath: 'C:\\repo\\report.md' })
  })
  it('routes only web URLs externally and rejects unsupported navigation', () => {
    expect(conversationLink('//example.com')).toEqual({ url: 'https://example.com' })
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', '#title', '', 'relative.md', 'bad%00file']) {
      expect(conversationLink(href)).toBeNull()
    }
  })
})
