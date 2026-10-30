import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { productKindForPath, toProductFileEntry } from '../../../src/shared/product'
import { buildOfficePreviewUrl, getOfficeErrorCopy, OfficePreviewFrame } from '../../../src/renderer/src/components/office/OfficePreviewFrame'

vi.mock('../../../src/renderer/src/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, currentLanguage: 'en' }),
}))

describe('product workspace kind mapping', () => {
  it('routes office, markdown and html files while rejecting the rest', () => {
    expect(productKindForPath('deck.pptx')).toBe('office')
    expect(productKindForPath('report.DOCX')).toBe('office')
    expect(productKindForPath('notes.md')).toBe('markdown')
    expect(productKindForPath('page.html')).toBe('html')
    expect(productKindForPath('diagram.png')).toBe('image')
    expect(productKindForPath('chart.SVG')).toBe('image')
    expect(productKindForPath('notes.txt')).toBe('text')
    expect(productKindForPath('config.json')).toBe('text')
    expect(productKindForPath('data.csv')).toBe('text')
    expect(productKindForPath('archive.zip')).toBe('unsupported')
    expect(toProductFileEntry({ relPath: 'a/b.md', mtimeMs: 3, size: 9 })).toEqual({ relPath: 'a/b.md', mtimeMs: 3, size: 9, kind: 'markdown', ext: '.md' })
  })
})

describe('current file preview boundary', () => {
  it('uses validated loopback ports and the minimal iframe policy', () => {
    expect(buildOfficePreviewUrl(65535)).toBe('http://127.0.0.1:65535/')
    expect(buildOfficePreviewUrl(0)).toBeNull()
    expect(buildOfficePreviewUrl(1.5)).toBeNull()
    const markup = renderToStaticMarkup(createElement(OfficePreviewFrame, { port: 4123, status: 'ready', onRetry: () => {}, onClose: () => {} }))
    expect(markup).toContain('src="http://127.0.0.1:4123/?janusLanguage=')
    expect(markup).toContain('sandbox="allow-scripts allow-same-origin"')
    expect(markup).toContain('referrerPolicy="no-referrer"')
    expect(markup).not.toContain('allow-popups')
    expect(markup).not.toContain('top-navigation')
  })
  it('renders stable error copy from the shared code', () => {
    const markup = renderToStaticMarkup(createElement(OfficePreviewFrame, { status: 'error', errorCode: 'TOO_MANY', onRetry: () => {}, onClose: () => {} }))
    expect(markup).toContain('editor:office.errorTooMany')
  })
  it('renders bundled reinstall copy for a missing engine', () => {
    const copy = getOfficeErrorCopy('NOT_INSTALLED')
    expect(copy).toContain('editor:office.errorNotInstalled')
  })
  it('keeps the retired product stage out of App and the fixed Panel', () => {
    // 统一文件窗口收敛产物列后，App 壳层不再挂独立产物工作区
    // — .agents/notes/workbench/unified-file-window.md
    const panel = readFileSync(new URL('../../../src/renderer/src/components/Panel.tsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../../../src/renderer/src/App.tsx', import.meta.url), 'utf8')
    expect(panel).not.toContain("setActiveView('office')")
    expect(panel).not.toContain('ProductWorkspacePanel')
    expect(app).not.toContain('ProductWorkspacePanel')
    expect(app).not.toContain('productResizing')
    expect(app).toContain('aria-label="Resize embedded editor"')
    expect(app).toContain('onLostPointerCapture=')
    expect(app).toContain('setPointerCapture(event.pointerId)')
    expect(app).not.toContain('addEventListener(\'pointermove\'')
  })
})
