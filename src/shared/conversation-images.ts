/** Only explicit local Markdown images are artifacts; never guess paths from prose. */
const imageLink = /!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g
export function conversationImageLinks(text: string): string[] {
  return [...new Set([...text.matchAll(imageLink)].map(match => match[2] ?? match[3])
    .filter(path => !/^(?:[a-z][\w+.-]*:|\/\/|\\\\)/i.test(path) || /^(?:[a-z]:[\\/]|file:)/i.test(path))
    .filter(path => /\.(png|jpe?g|gif|webp)$/i.test(path)))].slice(0, 8)
}
/** Keep a file link in the answer; the artifact card owns its image preview. */
export function conversationImageText(text: string, sources: string[]): string {
  return text.replace(imageLink, (match, _alt, angle, plain) => sources.includes(angle ?? plain) ? match.slice(1) : match)
}
