/** Chat file links are filesystem paths, not routes within the application. */
export function conversationLink(href: string, cwd?: string): { url: string } | { filePath: string } | null {
  if (!href || /^[#?]/.test(href)) return null
  if (/^(https?:)?\/\//i.test(href)) return { url: href.startsWith('//') ? `https:${href}` : href }
  let path = href.replace(/(\.[^/\\:#?]+):\d+(?::\d+)?(?=[#?]|$)/, '$1')
  if (/^file:\/\//i.test(path)) {
    const url = new URL(path)
    path = url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${url.pathname}` : url.pathname
  } else if (/^[\w+.-]+:/.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null
  path = path.replace(/[?#].*$/, '').replace(/:\d+(?::\d+)?$/, '')
  try { path = decodeURIComponent(path) } catch { return null }
  if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
  if (!path || /[\u0000-\u001f]/.test(path)) return null
  if (!/^(?:[a-z]:[\\/]|[\\/])/i.test(path)) {
    if (!cwd) return null
    path = `${cwd.replace(/[\\/]+$/, '')}/${path}`
  }
  return { filePath: path }
}
