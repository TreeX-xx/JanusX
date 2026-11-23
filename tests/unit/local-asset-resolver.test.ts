import { describe, expect, it } from 'vitest'
import {
  dirnameOfAbsolutePath,
  isRemoteOrSpecialSrc,
  resolveLocalAssetAbsolutePath,
  stripAssetQueryAndHash,
} from '../../src/renderer/src/lib/local-asset-resolver'

describe('local asset src classification', () => {
  it('passes remote and special URLs through', () => {
    for (const src of [
      'https://example.com/a.png',
      'http://example.com/a.gif',
      'HTTP://example.com/a.png',
      'data:image/png;base64,abc',
      'blob:https://example.com/uuid',
      '//cdn.example.com/a.png',
      '#anchor',
      '?query=1',
      'mailto:a@b.com',
      '',
      '   ',
    ]) {
      expect(isRemoteOrSpecialSrc(src)).toBe(true)
      expect(resolveLocalAssetAbsolutePath(src, { workspacePath: 'C:\\ws', documentDir: 'C:\\ws\\docs' })).toBeNull()
    }
    expect(isRemoteOrSpecialSrc(undefined)).toBe(true)
    expect(isRemoteOrSpecialSrc('./a.png')).toBe(false)
  })

  it('strips query and hash before filesystem lookup', () => {
    expect(stripAssetQueryAndHash('a.png?v=1')).toBe('a.png')
    expect(stripAssetQueryAndHash('a.png#frag')).toBe('a.png')
    expect(stripAssetQueryAndHash('a.png?v=1#frag')).toBe('a.png')
  })
})

describe('resolveLocalAssetAbsolutePath', () => {
  it('keeps an explicit POSIX file URL absolute inside or outside a workspace', () => {
    const src = 'file:///Users/tree/assets/my%20diagram.png'
    expect(resolveLocalAssetAbsolutePath(src, {})).toBe('/Users/tree/assets/my diagram.png')
    expect(resolveLocalAssetAbsolutePath(src, { workspacePath: '/workspace' })).toBe('/Users/tree/assets/my diagram.png')
  })

  it('resolves document-relative paths with ./ and ../', () => {
    expect(resolveLocalAssetAbsolutePath('./a.png', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\docs\\a.png')
    expect(resolveLocalAssetAbsolutePath('../assets/b.gif', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs\\sub',
    })).toBe('C:\\ws\\docs\\assets\\b.gif')
    expect(resolveLocalAssetAbsolutePath('img/c.png', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\docs\\img\\c.png')
  })

  it('resolves workspace-root-relative paths with a leading slash', () => {
    expect(resolveLocalAssetAbsolutePath('/assets/a.png', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\assets\\a.png')
  })

  it('keeps posix separators on posix workspaces', () => {
    expect(resolveLocalAssetAbsolutePath('./a.png', {
      workspacePath: '/home/user/ws',
      documentDir: '/home/user/ws/docs',
    })).toBe('/home/user/ws/docs/a.png')
    expect(resolveLocalAssetAbsolutePath('/assets/a.png', {
      workspacePath: '/home/user/ws',
      documentDir: '/home/user/ws/docs',
    })).toBe('/home/user/ws/assets/a.png')
  })

  it('passes windows absolute paths through', () => {
    expect(resolveLocalAssetAbsolutePath('C:\\ws\\assets\\a.png', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\assets\\a.png')
    expect(resolveLocalAssetAbsolutePath('C:/ws/assets/a.png', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\assets\\a.png')
  })

  it('decodes URL-encoded names and unwraps angle destinations', () => {
    expect(resolveLocalAssetAbsolutePath('my%20image.png', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\docs\\my image.png')
    expect(resolveLocalAssetAbsolutePath('<my image.png>', {
      workspacePath: 'C:\\ws',
      documentDir: 'C:\\ws\\docs',
    })).toBe('C:\\ws\\docs\\my image.png')
  })

  it('returns null without any local base', () => {
    expect(resolveLocalAssetAbsolutePath('./a.png', {})).toBeNull()
    expect(resolveLocalAssetAbsolutePath('/assets/a.png', {})).toBeNull()
  })
})

describe('dirnameOfAbsolutePath', () => {
  it('keeps windows drive prefixes intact', () => {
    expect(dirnameOfAbsolutePath('C:\\ws\\docs\\a.md')).toBe('C:\\ws\\docs')
    expect(dirnameOfAbsolutePath('C:/ws/docs/a.md')).toBe('C:/ws/docs')
    expect(dirnameOfAbsolutePath('/home/user/ws/docs/a.md')).toBe('/home/user/ws/docs')
    expect(dirnameOfAbsolutePath(undefined)).toBeUndefined()
  })
})
