import './conversation-output.css'
import { memo, useContext, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Nodes, Root } from 'mdast'
import { MARKDOWN_COMPONENTS } from '@/components/viewers/markdown-components'
import { MarkdownAssetContext } from '@/components/viewers/local-asset'
import { conversationLink } from '@/lib/conversation-link'
import { conversationCitationMarkdown } from '@/lib/conversation-citations'

import { ConversationImageCopy } from '../ConversationImageCopy'
import imageStyles from '../ConversationImages.module.css'

function remarkLinkedConversationImages() {
  return (tree: Root) => {
    function visit(node: Nodes, inLink = false) {
      if (inLink && (node.type === 'image' || node.type === 'imageReference')) {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataLinkedConversationImage: true } }
      }
      if ('children' in node) {
        const linked = inLink || node.type === 'link' || node.type === 'linkReference'
        node.children.forEach(child => visit(child, linked))
      }
    }
    visit(tree)
  }
}

const MarkdownImage = MARKDOWN_COMPONENTS.img!
const CHAT_COMPONENTS: typeof MARKDOWN_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  mark: ({ children }) => <mark>{children}</mark>,
  code: ({ className, children }) => <code className={className}>{children}</code>,
  img: function ChatImage({ node, src, alt, title, width, height, srcSet, sizes }) {
    const output = useRef<HTMLSpanElement>(null)
    const [loaded, setLoaded] = useState<string | undefined>()
    const image = <MarkdownImage {...{ src, alt, title, width, height, srcSet, sizes }} />
    if (node?.properties.dataLinkedConversationImage) return image
    return <span ref={output} className={imageStyles.inlineCopy}
      onLoadCapture={() => setLoaded(src)} onErrorCapture={() => setLoaded(undefined)}>
      {image}
      <ConversationImageCopy key={src} getImage={() => output.current?.querySelector('img')} disabled={!src || loaded !== src} compact />
    </span>
  },
  a: function ChatLink({ href, children, title }) {
    const { workspacePath } = useContext(MarkdownAssetContext)
    const [error, setError] = useState('')
    const open = async () => {
      try {
        const target = conversationLink(href ?? '', workspacePath)
        if (!target) return
        if ('url' in target) await window.electron.file.openPreviewLink(target.url)
        else await window.electron.window.openEditor({ filePath: target.filePath, workspacePath })
        setError('')
      } catch (error) { setError(String(error)) }
    }
    return <><a href={href} title={title} className={href?.startsWith('file:') ? 'conversation-file-link' : undefined} style={{ overflowWrap: 'break-word' }}
      onClick={event => { event.preventDefault(); void open() }}
      onAuxClick={event => { event.preventDefault(); if (event.button === 1) void open() }}>{children}</a>
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
  return (
    <MarkdownAssetContext.Provider value={workspacePath ? { workspacePath } : context}>
    <div className={`markdown-preview chat-markdown${variant === 'conversation' ? ' conversation-markdown' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkLinkedConversationImages]}
        urlTransform={(url, key) => key === 'href' && (/^(?:file:\/\/|[a-z]:[\\/])/i.test(url) || /^[^:/]+\.[^/:]+:\d+(?::\d+)?$/.test(url)) ? url : defaultUrlTransform(url)}
        components={variant === 'conversation' ? CONVERSATION_COMPONENTS : CHAT_COMPONENTS}
      >
        {conversationCitationMarkdown(content, streaming)}
      </ReactMarkdown>
    </div>
    </MarkdownAssetContext.Provider>
  )
})

export function StreamingText({ content }: { content: string }) {
  return (
    <div className="janus-chat-streaming-text">
      <MarkdownContent content={content} variant="conversation" streaming />
      <span className="janus-chat-streaming-cursor" aria-hidden="true" />
    </div>
  )
}
