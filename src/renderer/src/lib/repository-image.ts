/** Resolve image resources without turning repository blob pages into image requests. */
export function resolveRepositoryImage(src: string, readmeUrl: string, repositoryKey: string, ref: string): { url: string; path?: string } | null {
  try {
    const [provider, name] = repositoryKey.split(':')
    const host = provider === 'github' ? 'github.com' : 'gitlab.com'
    const base = 'https://' + host + '/' + name + (provider === 'github' ? '/blob/' : '/-/blob/') + encodeURIComponent(ref) + '/'
    const url = src.startsWith('/') && !src.startsWith('//') ? new URL(src.slice(1), base) : new URL(src, readmeUrl)
    if (!src || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    const pathname = decodeURIComponent(url.pathname)
    const starts = provider === 'github' ? ['/' + name + '/blob/' + ref + '/', '/' + name + '/raw/' + ref + '/'] : ['/' + name + '/-/blob/' + ref + '/', '/' + name + '/-/raw/' + ref + '/']
    let start = url.hostname === host ? starts.find(start => pathname.startsWith(start)) : undefined
    if (provider === 'github' && url.hostname === 'raw.githubusercontent.com' && pathname.startsWith('/' + name + '/' + ref + '/')) start = '/' + name + '/' + ref + '/'
    return { url: url.href, ...(start ? { path: pathname.slice(start.length) } : {}) }
  } catch { return null }
}
