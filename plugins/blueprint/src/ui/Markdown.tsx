import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text, navigate }: { text: string; navigate?: (uri: string) => void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}
    urlTransform={url => /^note:\/\/[a-f\d-]+\/[a-f\d-]+(?:#.*)?$/i.test(url) ? url : defaultUrlTransform(url)}
    components={{ a: ({ href, children }) => href?.startsWith('note://')
      ? <button className="text-link" onClick={() => navigate?.(href.split('#')[0])}>{children}</button>
      : <span title={href}>{children}{href && <small> ({href})</small>}</span>,
      img: ({ alt }) => <span>[{alt ?? 'Image'}]</span> }}>{text}</ReactMarkdown></div>
}
