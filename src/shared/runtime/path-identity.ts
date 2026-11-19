// Note: .agents/notes/desktop/platform-runtime-boundaries.md
export type RuntimePathFlavor = 'windows' | 'posix'

export function runtimePathFlavor(path: string): RuntimePathFlavor {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || /^\/\/(?:wsl\.localhost|wsl\$)\//i.test(path) ? 'windows' : 'posix'
}

/** Comparison keys only. Never feed this value to filesystem reads or writes. */
export function runtimePathKey(path: string, flavor: RuntimePathFlavor = runtimePathFlavor(path)): string {
  if (!path || path.includes('\0')) return path
  if (flavor === 'posix') return path === '/' ? path : path.replace(/\/+$/, '') || '/'
  const slashes = path.replace(/\\/g, '/')
  const wsl = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i.exec(slashes)
  if (wsl) return `//wsl/${wsl[1].toLowerCase()}${(wsl[2] ?? '/').replace(/\/+$/, '') || '/'}`
  const trimmed = slashes.replace(/\/+$/, '')
  // Keep drive and UNC roots, without conflating drive-relative C: with C:/.
  return (/^[a-z]:$/i.test(trimmed) && /^[a-z]:\//i.test(slashes) ? `${trimmed}/` : trimmed || '/').toLowerCase()
}

export function sameRuntimePath(left: string, right: string, flavor?: RuntimePathFlavor): boolean {
  return runtimePathKey(left, flavor) === runtimePathKey(right, flavor)
}

export function withinRuntimePath(child: string, parent: string): boolean {
  const childKey = runtimePathKey(child), parentKey = runtimePathKey(parent)
  return Boolean(childKey && parentKey) && (childKey === parentKey || childKey.startsWith(parentKey.endsWith('/') ? parentKey : `${parentKey}/`))
}
