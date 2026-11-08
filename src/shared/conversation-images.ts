import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
// Only rendered Markdown images are artifacts; code and escaped examples stay literal.
function markdownImages(text: string): Array<{ source: string; offset: number }> {
  const images: Array<{ source: string; offset: number }> = []
  function visit(node: Nodes): void {
    if (node.type === 'image' && node.position?.start.offset !== undefined) {
      images.push({ source: node.url, offset: node.position.start.offset })
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(fromMarkdown(text))
  return images
}
export function conversationImageLinks(text: string): string[] {
  return [...new Set(markdownImages(text).map(image => image.source)
    .filter(path => !/^(?:[a-z][\w+.-]*:|\/\/|\\\\)/i.test(path) || /^(?:[a-z]:[\\/]|file:)/i.test(path))
    .filter(path => /\.(png|jpe?g|gif|webp)$/i.test(path)))].slice(0, 8)
}
/** Keep a file link in the answer; the artifact card owns its image preview. */
export function conversationImageText(text: string, sources: string[]): string {
  for (const image of markdownImages(text).reverse()) {
    if (sources.includes(image.source)) text = text.slice(0, image.offset) + text.slice(image.offset + 1)
  }
  return text
}
