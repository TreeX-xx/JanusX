import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_COMPONENTS } from '@/components/viewers/markdown-components'

// Conversation typography belongs to the pane; retain shared code, links and asset handling.
const CONVERSATION_COMPONENTS: typeof MARKDOWN_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  h1: ({ children }) => <h1>{children}</h1>,
  h2: ({ children }) => <h2>{children}</h2>,
  h3: ({ children }) => <h3>{children}</h3>,
  h4: ({ children }) => <h4>{children}</h4>,
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong>{children}</strong>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children }) => <ol>{children}</ol>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
}

/**
 * memo：流式期间父组件每次 delta 都会重渲染整个消息列表，
 * 历史消息 content 不变时跳过 react-markdown 的整段重解析（audit P1）。
 * 表格/代码块/引用等样式复用共享 MARKDOWN_COMPONENTS，与预览区保持全量统一。
 */
export const MarkdownContent = memo(function MarkdownContent({ content, variant }: { content: string; variant?: 'conversation' }) {
  // 注意：外层 JanusChat 已包了一层 .janus-chat-message-content（展开态自带左边 2px 橙线），
  // 这里只挂 markdown-preview，复用表格斑马纹等样式即可；若再挂 janus-chat-message-content
  // 会画出第二条竖线。
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={variant === 'conversation' ? CONVERSATION_COMPONENTS : MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export function StreamingText({ content }: { content: string }) {
  return (
    <div className="janus-chat-streaming-text">
      {content}
      <span className="janus-chat-streaming-cursor" aria-hidden="true" />
    </div>
  )
}
