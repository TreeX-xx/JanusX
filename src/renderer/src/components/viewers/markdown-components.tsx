/**
 * @file 共享的 Markdown 渲染组件样式
 * @description
 *  统一 MarkdownViewer / 产物工作区 LocalFileStage / QuickNote / 聊天区 MarkdownContent 的渲染外观。
 *  调用方：`<ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>`，
 *  外层包一层 `className="markdown-preview"`（聊天区同时保留 `janus-chat-message-content`）即可吃到
 *  markdown-preview.css 里的斑马纹 / hover / 滚动条增强。
 */

import { isValidElement, useState, type CSSProperties, type ReactNode, type ImgHTMLAttributes } from 'react'
import type { Components } from 'react-markdown'
import { useLocalAssetAbsolutePath, useLocalAssetUrl, useLocalAssetSrcSet } from './local-asset'
import { useThemeStore } from '@/stores/theme'
import { getThemeDefinition } from '../../../../shared/theme/registry'

const CODE_FONT = "'Cascadia Code', 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace"
const PROSE_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"

function getCodeText(children: ReactNode): string {
  if (typeof children === 'string') return children.replace(/\n$/, '')
  if (Array.isArray(children)) return children.map((child) => getCodeText(child)).join('')
  if (isValidElement<{ children?: ReactNode }>(children)) return getCodeText(children.props.children)
  return ''
}

function getLanguage(className?: string): string {
  const match = /language-([\w+-]+)/.exec(className ?? '')
  return match?.[1] ?? ''
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="md-codeblock-copy"
      aria-label={copied ? '已复制代码' : '复制代码'}
      onClick={() => {
        if (!text) return
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }}
      style={{
        background: copied ? 'var(--accent-mid)' : 'var(--shell-hover)',
        border: '1px solid var(--control-border)',
        borderRadius: 4,
        color: copied ? 'var(--shell-accent-strong)' : 'var(--shell-muted)',
        fontSize: 10,
        lineHeight: 1,
        padding: '4px 8px',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function CodeBlockFrame({ children }: { children: ReactNode }) {
  const codeElement = Array.isArray(children) ? children[0] : children
  const language = isValidElement<{ className?: string }>(codeElement)
    ? getLanguage(codeElement.props.className)
    : ''
  const text = getCodeText(children)
  return (
    <div
      className="md-codeblock"
      style={{
        background: 'var(--shell-drawer)',
        border: '1px solid var(--control-border)',
        borderRadius: 8,
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 10px',
          background: 'transparent',
          borderBottom: '1px solid var(--shell-border)',
        }}
      >
        <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--shell-muted)', fontFamily: CODE_FONT }}>
          {language || 'code'}
        </span>
        <CopyButton text={text} />
      </div>
      <pre
        style={{
          margin: 0,
          padding: 12,
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: 480,
        }}
      >
        {children}
      </pre>
    </div>
  )
}

const thStyle: CSSProperties = {
  border: '1px solid var(--control-border)',
  padding: '8px 12px',
  background: 'var(--shell-hover)',
  color: 'var(--shell-text)',
  fontWeight: 700,
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  border: '1px solid var(--control-border)',
  padding: '8px 12px',
  color: 'var(--shell-text)',
  lineHeight: 1.6,
  verticalAlign: 'top',
}

export function ResolvedMarkdownImage({ src, alt, srcSet, sizes, width, height, title, onLoad, onError }: Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'srcSet' | 'sizes' | 'width' | 'height' | 'title' | 'onLoad' | 'onError'>) {
  const absolutePath = useLocalAssetAbsolutePath(src)
  const resolved = useLocalAssetUrl(src)
  const resolvedSrcSet = useLocalAssetSrcSet(srcSet)
  // Local files load through `file:readBinary` into a `data:` URL because the
  // renderer cannot reach workspace paths directly. While a local asset is
  // still loading the `src` stays unset so a relative path never fires a
  // broken request against the app bundle; remote URLs render immediately.
  const pendingLocal = Boolean(absolutePath && !resolved)
  return (
    <img
      src={pendingLocal ? undefined : resolved}
      srcSet={resolvedSrcSet}
      sizes={sizes}
      width={width}
      height={height}
      title={title}
      alt={alt ?? ''}
      loading="lazy"
      onLoad={onLoad}
      onError={onError}
      style={{
        maxWidth: '100%',
        height: 'auto',
        display: 'block',
        borderRadius: 8,
        border: '1px solid var(--control-border)',
        margin: '10px 0',
        background: 'var(--shell-canvas)',
      }}
    />
  )
}

function ResolvedMarkdownSource({ srcSet, media, type, sizes }: { srcSet?: string; media?: string; type?: string; sizes?: string }) {
  const theme = useThemeStore(state => state.theme)
  const scheme = getThemeDefinition(theme).base
  const effectiveMedia = media?.replace(/\(prefers-color-scheme:\s*(dark|light)\)/gi,
    (_query, value: string) => value.toLowerCase() === scheme ? '(min-width: 0px)' : '(max-width: 0px)')
  const resolved = useLocalAssetSrcSet(srcSet)
  return <source srcSet={resolved} media={effectiveMedia} type={type} sizes={sizes} />
}

// Note: emphasis renders as orange type with no fill blocks — see .agents/notes/workbench/markdown-emphasis-orange-text.md
export const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 style={{ color: 'var(--shell-text)', fontSize: 22, fontWeight: 700, marginBottom: 12, marginTop: 20, lineHeight: 1.3, paddingBottom: 8, borderBottom: '1px solid var(--control-border)' }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ color: 'var(--shell-text)', fontSize: 18, fontWeight: 700, marginBottom: 10, marginTop: 18, lineHeight: 1.35, paddingBottom: 6, borderBottom: '1px solid var(--shell-border)' }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ color: 'var(--shell-text)', fontSize: 15, fontWeight: 700, marginBottom: 8, marginTop: 16, lineHeight: 1.35 }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ color: 'var(--shell-text)', fontSize: 13, fontWeight: 700, marginBottom: 6, marginTop: 14, lineHeight: 1.4 }}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ color: 'var(--shell-text)', fontSize: 12, fontWeight: 700, marginBottom: 6, marginTop: 12, lineHeight: 1.4 }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ color: 'var(--shell-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6, marginTop: 12, lineHeight: 1.4 }}>
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p style={{ color: 'var(--shell-text)', fontSize: 13, lineHeight: 1.75, marginBottom: 10, fontFamily: PROSE_FONT, overflowWrap: 'break-word' }}>
      {children}
    </p>
  ),
  a: ({ href, children }) => (
    <a href={href} style={{ color: 'var(--shell-accent-strong)', textDecoration: 'none', overflowWrap: 'break-word' }}>
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong style={{ color: 'var(--shell-accent-strong)', fontWeight: 700 }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ color: 'var(--shell-accent-strong)', fontStyle: 'italic' }}>{children}</em>
  ),
  del: ({ children }) => (
    <del style={{ color: 'var(--shell-muted)' }}>{children}</del>
  ),
  img: ({ src, alt, srcSet, sizes, width, height, title }) => <ResolvedMarkdownImage src={src} alt={alt ?? ''} srcSet={srcSet} sizes={sizes} width={width} height={height} title={title} />,
  source: ({ srcSet, media, type, sizes }) => <ResolvedMarkdownSource srcSet={srcSet} media={media} type={type} sizes={sizes} />,
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      style={{ accentColor: 'var(--shell-accent)', width: 13, height: 13, marginRight: 6, verticalAlign: -2 }}
    />
  ),
  code: ({ className, children }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: 0,
            fontSize: 12,
            color: 'var(--shell-accent-strong)',
            fontFamily: CODE_FONT,
            overflowWrap: 'break-word',
          }}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className={className}
        style={{
          fontFamily: CODE_FONT,
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--shell-text)',
          whiteSpace: 'pre',
        }}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => <CodeBlockFrame>{children}</CodeBlockFrame>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: '3px solid var(--shell-accent)',
        background: 'transparent',
        borderRadius: 0,
        padding: '2px 0 2px 12px',
        color: 'var(--shell-muted)',
        margin: '0 0 12px',
        fontFamily: PROSE_FONT,
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      {children}
    </blockquote>
  ),
  mark: ({ children }) => (
    <mark style={{ background: 'transparent', color: 'var(--shell-accent-strong)', padding: 0 }}>{children}</mark>
  ),
  ul: ({ children }) => (
    <ul style={{ color: 'var(--shell-text)', fontSize: 13, lineHeight: 1.7, marginBottom: 10, paddingLeft: 20, fontFamily: PROSE_FONT }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{ color: 'var(--shell-text)', fontSize: 13, lineHeight: 1.7, marginBottom: 10, paddingLeft: 20, fontFamily: PROSE_FONT }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{ marginBottom: 5, overflowWrap: 'break-word' }}>{children}</li>
  ),
  hr: () => (
    <hr
      style={{
        border: 'none',
        borderTop: '1px solid var(--shell-border)',
        margin: '18px 0',
      }}
    />
  ),
  table: ({ children }) => (
    <div
      className="md-table-wrap"
      style={{
        overflowX: 'auto',
        marginBottom: 14,
        border: '1px solid var(--control-border)',
        borderRadius: 8,
        background: 'transparent',
      }}
    >
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          minWidth: 480,
          fontSize: 12.5,
          fontFamily: PROSE_FONT,
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: 'transparent' }}>{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="md-tr">{children}</tr>,
  th: ({ children }) => <th style={thStyle}>{children}</th>,
  td: ({ children }) => <td style={tdStyle}>{children}</td>,
}

/** File previews may contain raw HTML; external links leave the editor intact. */
export const FILE_MARKDOWN_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  a: ({ href, children, title }) => {
    const external = Boolean(href && /^(?:https?:)?\/\//i.test(href))
    return <a href={href} title={title} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}
      style={{ color: 'var(--shell-accent-strong)', textDecoration: 'none', overflowWrap: 'break-word' }}
      onClick={event => {
        if (!external || !href) return
        event.preventDefault()
        const url = href.startsWith('//') ? `https:${href}` : href
        void window.electron.file.openPreviewLink(url).catch(error => console.error('Could not open preview link', error))
      }}>{children}</a>
  },
}
