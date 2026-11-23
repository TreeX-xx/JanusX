import './conversation-output.css'
import { memo, useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Nodes, Root } from 'mdast'
import { MARKDOWN_COMPONENTS, ResolvedMarkdownImage } from '@/components/viewers/markdown-components'
import { MarkdownAssetContext } from '@/components/viewers/local-asset'
import { useConversationImagePreview } from '../ConversationImagePreview'
import { ConversationImageCopy } from '../ConversationImageCopy'
import imageStyles from '../ConversationImages.module.css'
import { conversationLink } from '@/lib/conversation-link'
import { conversationCitationMarkdown, isConversationPreviewFile, type ConversationReferenceKind } from '@/lib/conversation-citations'

function containsImage(node: Nodes): boolean {
  return node.type === 'image' || node.type === 'imageReference' || ('children' in node && node.children.some(containsImage))
}

function remarkConversationPreviews(references: Map<number, ConversationReferenceKind>) {
  return (tree: Root) => {
    function visit(node: Nodes, inLink = false, standalone = false) {
      const link = node.type === 'link' || node.type === 'linkReference'
      if (link) {
        const kind = references.get(node.position?.start.offset ?? -1)
        if (kind === 'preview' || (!kind && standalone && !containsImage(node))) {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataConversationArtifact: true } }
        }
      }
      if (inLink && (node.type === 'image' || node.type === 'imageReference')) {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataLinkedConversationImage: true } }
      }
      if ('children' in node) node.children.forEach(child => visit(child, inLink || link, node.type === 'paragraph' && node.children.length === 1))
    }
    visit(tree)
  }
}

function previewFile(href: string, workspacePath?: string): string | undefined {
  try {
    const target = conversationLink(href, workspacePath)
    if (target && 'filePath' in target && isConversationPreviewFile(target.filePath)) return target.filePath
  } catch { /* The existing open action reports malformed links. */ }
}

const CHAT_COMPONENTS: typeof MARKDOWN_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  mark: ({ children }) => <mark>{children}</mark>,
  code: ({ className, children }) => <code className={className}>{children}</code>,
  img: function ChatImage({ node, src, alt, title, width, height, srcSet, sizes }) {
    const { t } = useTranslation('terminal')
    const [loaded, setLoaded] = useState<string | undefined>()
    const imageOutput = useRef<HTMLSpanElement>(null)
    const { open, preview } = useConversationImagePreview()
    const image = { src, alt, title, width, height, srcSet, sizes }
    if (node?.properties.dataLinkedConversationImage) return <ResolvedMarkdownImage {...image} />
    const label = t('conversation.images.preview')
    return <span className={imageStyles.inlineCopy} ref={imageOutput}>
      <button type="button" className="conversation-inline-image" disabled={!src || loaded !== src}
        aria-label={alt ? `${label} · ${alt}` : label}
        onClick={event => {
          const thumbnail = event.currentTarget.querySelector('img')
          if (thumbnail?.complete && thumbnail.naturalWidth) open(thumbnail.currentSrc, alt ?? '', event.currentTarget)
        }}>
        <ResolvedMarkdownImage {...image} onLoad={() => setLoaded(src)} onError={() => setLoaded(undefined)} />
      </button>
      <ConversationImageCopy key={src} getImage={() => imageOutput.current?.querySelector('img')} disabled={!src || loaded !== src} compact />
      {preview}
    </span>
  },
  a: function ChatLink({ node, href, children, title }) {
    const { workspacePath } = useContext(MarkdownAssetContext)
    const { t } = useTranslation('common')
    const [error, setError] = useState('')
    const artifact = href && node?.properties.dataConversationArtifact ? previewFile(href, workspacePath) : undefined
    const open = async () => {
      try {
        const target = conversationLink(href ?? '', workspacePath)
        if (!target) return
        if ('url' in target) await window.electron.file.openPreviewLink(target.url)
        else {
          const result = await window.electron.window.openEditor({ filePath: target.filePath, workspacePath })
          if (result?.error) throw new Error(result.error)
        }
        setError('')
      } catch (error) { setError(String(error)) }
    }
    return <><a href={href} title={title ?? artifact} className={artifact ? 'conversation-artifact-link' : href?.startsWith('file:') ? 'conversation-file-link' : undefined} style={{ overflowWrap: 'break-word' }}
      onClick={event => { event.preventDefault(); void open() }}
      onAuxClick={event => { event.preventDefault(); if (event.button === 1) void open() }}>
      {artifact ? <><span>{artifact.split(/[\\/]/).pop()}</span><span>{t('action.openPreview')}</span></> : children}
    </a>
      {error && <span role="alert">{error}</span>}</>
  },
}

// Both conversation surfaces share typography, code, links and asset handling.
const CONVERSATION_COMPONENTS: typeof MARKDOWN_COMPONENTS = {
  ...CHAT_COMPONENTS,
  h1: ({ children }) => <h1>{children}</h1>,
  h2: ({ children }) => <h2>{children}</h2>,
  h3: ({ children }) => <h3>{children}</h3>,
  h4: ({ children }) => <h4>{children}</h4>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children, start }) => <ol start={start}>{children}</ol>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
}

/**
 * memo：流式期间父组件每次 delta 都会重渲染整个消息列表，
 * 历史消息 content 不变时跳过 react-markdown 的整段重解析（audit P1）。
 * 表格/代码块/引用等样式复用共享 MARKDOWN_COMPONENTS，与预览区保持全量统一。
 */
export const MarkdownContent = memo(function MarkdownContent({ content, variant, workspacePath, streaming = false }: { content: string; variant?: 'conversation'; workspacePath?: string; streaming?: boolean }) {
  const context = useContext(MarkdownAssetContext)
  const { t } = useTranslation('common')
  const references = new Map<number, ConversationReferenceKind>()
  const markdown = conversationCitationMarkdown(content, streaming, t('action.openPreview'), references)
  return (
    <MarkdownAssetContext.Provider value={workspacePath ? { workspacePath } : context}>
    <div className={`markdown-preview chat-markdown${variant === 'conversation' ? ' conversation-markdown' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkConversationPreviews, references]]}
        urlTransform={(url, key) => /^(?:file:\/\/|[a-z]:[\\/])/i.test(url) || (key === 'href' && /^[^:/]+\.[^/:]+:\d+(?::\d+)?$/.test(url)) ? url : defaultUrlTransform(url)}
        components={variant === 'conversation' ? CONVERSATION_COMPONENTS : CHAT_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
    </MarkdownAssetContext.Provider>
  )
})

export function StreamingText({ content, workspacePath }: { content: string; workspacePath?: string }) {
  return (
    <div className="janus-chat-streaming-text">
      <MarkdownContent content={content} variant="conversation" workspacePath={workspacePath} streaming />
      <span className="janus-chat-streaming-cursor" aria-hidden="true" />
    </div>
  )
}
