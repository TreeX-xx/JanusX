// Pure resolver for workspace-local preview assets (no React, no Electron).
// Testable under node; the IPC-backed loader lives in components/viewers/local-asset.tsx.
// Note: leading `/` means workspace-root while a workspace is known — see .agents/notes/workbench/markdown-preview-local-assets.md

import { parseRuntimeResource, runtimeResource } from '../../../shared/workspace-runtime'

export const LOCAL_ASSET_MAX_BYTES = 8 * 1024 * 1024

export const LOCAL_ASSET_DOC_LIMIT = 30

export function isPreviewImageUrl(value: string): boolean {
  const url = value.trim()
  if (/^data:/i.test(url)) return /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml|bmp|x-icon)[;,]/i.test(url)
  if (/^(?:https?:|file:|[a-z]:[\\/])/i.test(url)) return true
  return !/^[\w+.-]+:/.test(url.replace(/[\u0000-\u0020]/g, ''))
}

const REMOTE_SCHEMES = ['http://', 'https://', 'data:', 'blob:', 'mailto:', 'tel:', 'javascript:']

export function isRemoteOrSpecialSrc(src: string | undefined | null): boolean {
  if (src === undefined || src === null) return true
  const trimmed = src.trim()
  if (trimmed === '') return true
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) return true
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('//')) return true
  return REMOTE_SCHEMES.some((scheme) => lower.startsWith(scheme))
}

export function stripAssetQueryAndHash(src: string): string {
  const query = src.indexOf('?')
  const hash = src.indexOf('#')
  let end = src.length
  if (query >= 0) end = Math.min(end, query)
  if (hash >= 0) end = Math.min(end, hash)
  return src.slice(0, end)
}

function unwrapAngleBrackets(src: string): string {
  const trimmed = src.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function safeDecode(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizePosix(path: string): string {
  const isAbsolute = path.startsWith('/')
  const hasDrive = /^[a-zA-Z]:\//.test(path)
  const parts = path.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      const top = stack[stack.length - 1]
      if (stack.length > 0 && top !== '..' && !(stack.length === 1 && /^[a-zA-Z]:$/.test(top))) {
        stack.pop()
      } else if (!isAbsolute && !hasDrive) {
        stack.push('..')
      }
      continue
    }
    stack.push(part)
  }
  const joined = stack.join('/')
  if (hasDrive) return joined
  if (isAbsolute) return `/${joined}`
  return joined
}

function joinPosix(base: string, rel: string): string {
  if (rel.startsWith('/')) return normalizePosix(rel)
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  return normalizePosix(`${trimmedBase}/${rel}`)
}

function toOsSeparators(posixPath: string, useBackslash: boolean): string {
  if (!useBackslash) return posixPath
  if (/^[a-zA-Z]:\//.test(posixPath)) {
    return `${posixPath.slice(0, 2)}\\${posixPath.slice(3).replace(/\//g, '\\')}`
  }
  return posixPath.replace(/\//g, '\\')
}

function stripFileScheme(src: string): string | null {
  const lower = src.toLowerCase()
  if (!lower.startsWith('file://')) return null
  let rest = src.slice('file://'.length)
  if (rest.startsWith('localhost/')) rest = rest.slice('localhost/'.length)
  // file:///C:/... -> C:/...
  if (/^\/[a-zA-Z]:\//.test(rest)) rest = rest.slice(1)
  return rest
}

export interface ResolveAssetOptions {
  workspacePath?: string | null
  documentDir?: string | null
}

/**
 * Resolve a markdown/html asset `src` to an absolute workspace file path.
 * Returns null for remote/special URLs or when no local base exists.
 * A leading `/` resolves workspace-root-relative when a workspace is known.
 */
export function resolveLocalAssetAbsolutePath(
  rawSrc: string | undefined | null,
  options: ResolveAssetOptions = {},
): string | null {
  if (isRemoteOrSpecialSrc(rawSrc)) return null
  const unwrapped = unwrapAngleBrackets(String(rawSrc))
  if (unwrapped === '') return null
  if (unwrapped.includes('\0')) return null
  const fromFileScheme = stripFileScheme(unwrapped)
  const cleaned = stripAssetQueryAndHash(fromFileScheme ?? unwrapped).trim()
  if (cleaned === '') return null
  const decoded = safeDecode(cleaned)
  const posix = toPosix(decoded)
  const remoteRoot = parseRuntimeResource(options.workspacePath)
  const remoteDirectory = parseRuntimeResource(options.documentDir)
  if (remoteRoot || remoteDirectory) {
    // file:// and Windows paths cannot escape from a target environment to
    // files on the desktop. Relative assets retain the workspace identity.
    if (fromFileScheme !== null || /^[\w+.-]+:/.test(posix) || posix.startsWith('//')) return null
    const base = posix.startsWith('/') ? remoteRoot : remoteDirectory ?? remoteRoot
    if (!base || (remoteRoot && base.workspaceId !== remoteRoot.workspaceId)) return null
    const path = joinPosix(base.path, posix.startsWith('/') ? posix.slice(1) : posix)
    if (remoteRoot && path !== remoteRoot.path && !path.startsWith(remoteRoot.path.replace(/\/+$/, '') + '/')) return null
    return runtimeResource(base.workspaceId, path)
  }
  const useBackslash =
    (options.workspacePath ?? options.documentDir ?? '').includes('\\') || /\\/.test(decoded)

  // Windows absolute (C:/..., C:\...) and UNC (//server/share).
  if (/^[a-zA-Z]:\//.test(posix)) {
    return toOsSeparators(normalizePosix(posix), useBackslash)
  }
  if (posix.startsWith('//')) {
    const normalized = normalizePosix(posix)
    return useBackslash ? normalized.replace(/\//g, '\\') : normalized
  }
  const workspacePosix = options.workspacePath ? toPosix(options.workspacePath) : ''
  const documentPosix = options.documentDir ? toPosix(options.documentDir) : ''
  // Leading `/` is workspace-root-relative while a workspace is known.
  if (posix.startsWith('/')) {
    if (!workspacePosix) return null
    const root = workspacePosix.replace(/\/+$/, '')
    return toOsSeparators(joinPosix(`${root}/`, posix.slice(1)), useBackslash)
  }
  const base = documentPosix || workspacePosix
  if (!base) return null
  return toOsSeparators(joinPosix(base, posix), useBackslash)
}

export function dirnameOfAbsolutePath(absolutePath: string | undefined | null): string | undefined {
  if (!absolutePath) return undefined
  const posix = toPosix(absolutePath)
  const trimmed = posix.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash < 0) return undefined
  // Keep `C:` drive prefix intact (`C:/dir` -> `C:/`, never bare `C:`).
  if (/^[a-zA-Z]:$/.test(trimmed.slice(0, slash))) return `${trimmed.slice(0, slash + 1)}`
  const dir = trimmed.slice(0, slash) || '/'
  return absolutePath.includes('\\') ? dir.replace(/\//g, '\\') : dir
}
